import CoreBluetooth
import Foundation
import NextSetSyncCore

/// A watch seen while scanning.
struct DiscoveredWatch: Identifiable, Hashable {
    let id: UUID
    let name: String
    let rssi: Int
}

enum LinkEvent {
    case stateChanged(CBManagerState)
    case discovered(DiscoveredWatch)
    case connecting(UUID)
    case ready(BLEWatchLink, name: String)
    case disconnected(UUID, Error?)
    case failed(String)
}

/// Core Bluetooth central for the Bangle.js 2.
///
/// * Scans in the foreground by name ("Bangle.js xxxx"): the watch advertises
///   only its name and the Nordic UART service, not ours.
/// * Remembers the chosen watch by CBPeripheral.identifier and reconnects with
///   `connect()`, which never times out: iOS completes it whenever the watch is
///   back in range, in the background too (UIBackgroundModes bluetooth-central).
/// * State restoration (CBCentralManagerOptionRestoreIdentifierKey) lets iOS
///   relaunch the app for a pending connection after it was suspended or
///   terminated by the system (not after the user force-quits it).
final class BLEManager: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate, @unchecked Sendable {
    static let service = CBUUID(string: SyncProtocol.serviceUUID)
    static let rx = CBUUID(string: SyncProtocol.rxCharacteristicUUID)
    static let tx = CBUUID(string: SyncProtocol.txCharacteristicUUID)

    private var central: CBCentralManager!
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var links: [UUID: BLEWatchLink] = [:]
    private var wantConnected: UUID?
    var onEvent: ((LinkEvent) -> Void)?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main, options: [
            CBCentralManagerOptionRestoreIdentifierKey: "nextset-sync-central",
            CBCentralManagerOptionShowPowerAlertKey: true,
        ])
    }

    var state: CBManagerState { central.state }

    func startScan() {
        guard central.state == .poweredOn else { return }
        central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func stopScan() { if central.isScanning { central.stopScan() } }

    /// Connects now if possible, otherwise as soon as the watch is in range.
    func connect(_ id: UUID) {
        wantConnected = id
        guard central.state == .poweredOn else { return }
        let p = peripherals[id] ?? central.retrievePeripherals(withIdentifiers: [id]).first
        guard let p else { onEvent?(.failed("This iPhone no longer knows that watch. Scan and pair again.")); return }
        peripherals[id] = p
        p.delegate = self
        if p.state == .connected { discover(p); return }
        onEvent?(.connecting(id))
        central.connect(p, options: [CBConnectPeripheralOptionNotifyOnDisconnectionKey: false])
    }

    /// Disconnects and stops reconnecting (so the App Loader can use the watch).
    func disconnect() {
        guard let id = wantConnected else { return }
        wantConnected = nil
        if let p = peripherals[id] { central.cancelPeripheralConnection(p) }
    }

    // MARK: central delegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        onEvent?(.stateChanged(central.state))
        if central.state == .poweredOn, let id = wantConnected { connect(id) }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        for p in restored {
            p.delegate = self
            peripherals[p.identifier] = p
            wantConnected = p.identifier
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
        guard name.hasPrefix("Bangle.js") else { return }
        peripherals[peripheral.identifier] = peripheral
        onEvent?(.discovered(DiscoveredWatch(id: peripheral.identifier, name: name, rssi: RSSI.intValue)))
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        discover(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        onEvent?(.disconnected(peripheral.identifier, error))
        // Retry after a pause rather than spinning on a persistent error.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self, self.wantConnected == peripheral.identifier, peripheral.state == .disconnected else { return }
            central.connect(peripheral)
        }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        links.removeValue(forKey: peripheral.identifier)?.closed()
        onEvent?(.disconnected(peripheral.identifier, error))
        // Queue a new connection: completes whenever the watch is back in range.
        if wantConnected == peripheral.identifier { central.connect(peripheral) }
    }

    // MARK: peripheral delegate

    private func discover(_ p: CBPeripheral) {
        p.discoverServices([Self.service])
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let s = peripheral.services?.first(where: { $0.uuid == Self.service }) else {
            wantConnected = nil // stop reconnecting until the person tries again
            onEvent?(.failed("The NextSet Sync service was not found on \(peripheral.name ?? "the watch"). Install the watch app (then restart the watch), and if it is installed, turn the iPhone's Bluetooth off and on: iOS caches a watch's services."))
            central.cancelPeripheralConnection(peripheral)
            return
        }
        peripheral.discoverCharacteristics([Self.rx, Self.tx], for: s)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let tx = service.characteristics?.first(where: { $0.uuid == Self.tx }),
              service.characteristics?.contains(where: { $0.uuid == Self.rx }) == true else {
            onEvent?(.failed("The watch's sync service is incomplete. Update the watch app."))
            return
        }
        peripheral.setNotifyValue(true, for: tx)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic.uuid == Self.tx, characteristic.isNotifying,
              let rx = characteristic.service?.characteristics?.first(where: { $0.uuid == Self.rx }) else {
            if let error { onEvent?(.failed("Could not subscribe to the watch: \(error.localizedDescription)")) }
            return
        }
        // Negotiated ATT MTU - 3; Bangle.js 2 allows up to 128.
        let size = max(SyncProtocol.minChunk, min(SyncProtocol.maxChunk, peripheral.maximumWriteValueLength(for: .withoutResponse)))
        let link = BLEWatchLink(peripheral: peripheral, rx: rx, chunkSize: size)
        links[peripheral.identifier] = link
        onEvent?(.ready(link, name: peripheral.name ?? "Bangle.js"))
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic.uuid == Self.tx, let v = characteristic.value else { return }
        links[peripheral.identifier]?.received(v)
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        links[peripheral.identifier]?.writeFinished(error)
    }
}

/// One connection's byte pipe. Writes use "with response", so each chunk is
/// confirmed by the watch's Bluetooth stack before the next is sent.
final class BLEWatchLink: WatchLink, @unchecked Sendable {
    let chunkSize: Int
    private let peripheral: CBPeripheral
    private let rx: CBCharacteristic
    private var pendingWrite: CheckedContinuation<Void, Error>?
    private var isClosed = false
    /// Set by the app model: forwards notifications to the sync engine in order.
    var onData: ((Data) -> Void)?
    var onClosed: (() -> Void)?

    init(peripheral: CBPeripheral, rx: CBCharacteristic, chunkSize: Int) {
        self.peripheral = peripheral; self.rx = rx; self.chunkSize = chunkSize
    }

    func write(_ chunk: Data) async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            DispatchQueue.main.async {
                guard !self.isClosed, self.peripheral.state == .connected else { c.resume(throwing: WireError.notConnected); return }
                self.pendingWrite = c
                self.peripheral.writeValue(chunk, for: self.rx, type: .withResponse)
            }
        }
    }

    func writeFinished(_ error: Error?) {
        let c = pendingWrite; pendingWrite = nil
        if let error { c?.resume(throwing: error) } else { c?.resume() }
    }

    func received(_ data: Data) { onData?(data) }

    func closed() {
        isClosed = true
        pendingWrite?.resume(throwing: WireError.notConnected); pendingWrite = nil
        onClosed?()
    }
}
