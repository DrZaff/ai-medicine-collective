import Foundation

/// Protocol v1 constants. The watch side is `watch/nsync/lib.js`; the
/// contract is `docs/protocol.md`.
public enum SyncProtocol {
    public static let version = 1
    public static let serviceUUID = "D9A50001-3C1F-4B0E-9F5D-7A1E6C2B8F40"
    /// Phone -> watch (write with response).
    public static let rxCharacteristicUUID = "D9A50002-3C1F-4B0E-9F5D-7A1E6C2B8F40"
    /// Watch -> phone (notify).
    public static let txCharacteristicUUID = "D9A50003-3C1F-4B0E-9F5D-7A1E6C2B8F40"
    /// Largest characteristic value the watch accepts (Bangle.js 2 ATT MTU 131 - 3).
    public static let maxChunk = 128
    public static let minChunk = 20
}

/// Every message in either direction. Fields are optional; `t` says which apply.
public struct WireMessage: Codable, Equatable, Sendable {
    public var t: String
    public var q: Int?
    public var v: Int?
    public var min: Int?
    public var phone: String?
    public var mtu: Int?
    public var name: String?
    public var code: String?
    public var proof: String?
    public var key: String?
    public var watch: String?
    public var app: String?
    public var fw: String?
    public var paired: Bool?
    public var nonce: String?
    public var re: String?
    public var msg: String?
    public var ms: Double?
    public var tz: Int?
    public var now: Double?
    public var w: WireWorkout?
    public var id: String?
    public var rev: Int?
    public var max: Int?
    public var recs: [WireRecord]?
    public var more: Bool?
    public var total: Int?
    public var ids: [WireAck]?
    public var n: Int?
    public var left: Int?
    public var since: Int?
    public var upto: Int?
    public var entries: [[Int]]?
    public var sl: SleepLogInfo?
    public var pend: Int?
    public var pendSets: Int?
    public var ses: ActiveSessionInfo?
    public var wkt: LoadedWorkoutInfo?
    public var sAck: Int?
    public var bat: Int?
    public var free: Int?

    public init(t: String) { self.t = t }

    public struct SleepLogInfo: Codable, Equatable, Sendable {
        public var ver: String?
        public var on: Bool?
        public var last: Int?
    }
    public struct ActiveSessionInfo: Codable, Equatable, Sendable {
        public var sid: String
        public var wn: String?
        public var xi: Int?
        public var sn: Int?
        public var n: Int?
        public var start: Double?
    }
    public struct LoadedWorkoutInfo: Codable, Equatable, Sendable {
        public var id: String
        public var rev: Int?
        public var name: String?
    }
}

/// An acknowledgment entry: [record id, rev], encoded as a two-element array.
public struct WireAck: Codable, Equatable, Sendable {
    public var id: String
    public var rev: Int
    public init(id: String, rev: Int) { self.id = id; self.rev = rev }
    public init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        id = try c.decode(String.self); rev = try c.decode(Int.self)
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(id); try c.encode(rev)
    }
}

/// Workout as sent to the watch: short keys, ASCII text, numbers only where the watch does math.
public struct WireWorkout: Codable, Equatable, Sendable {
    public var id: String
    public var rev: Int
    public var name: String
    public var units: String
    public var ex: [Exercise]
    public struct Exercise: Codable, Equatable, Sendable {
        public var id: String
        public var name: String
        public var sets: Int
        public var reps: String
        public var rir: Double?
        public var rest: Int
        public var load: Double?
        public var inc: Double?
    }
    public init(_ w: Workout) {
        id = w.id; rev = w.rev; name = WireText.ascii(w.name, limit: 40); units = w.units.rawValue
        ex = w.exercises.map {
            Exercise(id: WireText.ascii($0.id, limit: 40), name: WireText.ascii($0.name, limit: 40), sets: $0.sets,
                     reps: WireText.ascii($0.reps, limit: 12), rir: $0.rir, rest: $0.rest, load: $0.load,
                     inc: $0.increment)
        }
    }
}

/// A record from the watch's pending store (`k` = "set" or "ses").
public struct WireRecord: Codable, Equatable, Sendable {
    public var k: String
    public var id: String
    public var rev: Int
    public var sid: String
    public var wid: String?
    public var wn: String?
    public var xi: Int?
    public var xid: String?
    public var xn: String?
    public var set: Int?
    public var load: Double?
    public var units: String?
    public var reps: Int?
    public var rir: Double?
    public var at: Double
    public var ed: Double?
    public var del: Int?
    public var start: Double?
    public var end: Double?
    public var n: Int?
}

public enum WireError: Error, Equatable, LocalizedError {
    case badFrame(String)
    case watch(code: String, re: String?)
    case timeout(String)
    case notConnected
    case protocolMismatch(Int)
    case unexpected(String)
    public var errorDescription: String? {
        switch self {
        case .badFrame(let s): return "Damaged message from the watch (\(s))."
        case .watch(let code, _):
            switch code {
            case "not_pairing": return "On the watch, open NextSet Sync and choose Pair phone first."
            case "pair_refused": return "Pairing was declined on the watch."
            case "auth_failed": return "The watch no longer recognises this iPhone. Pair again."
            case "unauthorized": return "The watch needs this iPhone to pair first."
            case "no_sleeplog": return "Sleep Log is not installed on the watch."
            case "bad_workout": return "The watch rejected the workout (check sets and exercises)."
            default: return "Watch error: \(code)."
            }
        case .timeout(let s): return "The watch did not answer (\(s))."
        case .notConnected: return "Not connected to the watch."
        case .protocolMismatch(let v): return "The watch app speaks protocol v\(v); update both apps."
        case .unexpected(let s): return s
        }
    }
}

public enum WireText {
    /// Watch fonts are ISO 8859-1; send plain ASCII. Common typography becomes
    /// its ASCII twin ("8–12" -> "8-12"); anything else is dropped.
    public static func ascii(_ s: String, limit: Int = 200) -> String {
        let map: [Character: String] = ["–": "-", "—": "-", "‒": "-", "−": "-", "‘": "'", "’": "'", "“": "\"",
                                        "”": "\"", "×": "x", "…": "...", "·": "-", "\u{00A0}": " "]
        var out = ""
        for ch in s.precomposedStringWithCanonicalMapping {
            if let m = map[ch] { out += m; continue }
            if ch.isASCII, let v = ch.asciiValue, v >= 32, v < 127 { out.append(ch); continue }
            // Strip accents: "é" -> "e".
            let folded = String(ch).folding(options: [.diacriticInsensitive, .widthInsensitive], locale: nil)
            out += folded.filter { $0.isASCII && ($0.asciiValue ?? 0) >= 32 }
        }
        return String(out.prefix(limit))
    }
}

/// Encodes and decodes "<len>:<json>\n" frames.
public enum Framing {
    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }()

    /// One message as bytes, ASCII only (non-ASCII is \u-escaped).
    public static func frame(_ m: WireMessage) throws -> Data {
        let json = try encoder.encode(m)
        let ascii = escapeNonASCII(String(decoding: json, as: UTF8.self))
        return Data("\(ascii.utf8.count):\(ascii)\n".utf8)
    }

    /// Splits a frame into characteristic writes.
    public static func chunks(_ frame: Data, size: Int) -> [Data] {
        let n = Swift.max(1, size)
        return stride(from: 0, to: frame.count, by: n).map { frame.subdata(in: $0..<Swift.min($0 + n, frame.count)) }
    }

    static func escapeNonASCII(_ s: String) -> String {
        var out = ""
        for u in s.utf16 {
            if u < 0x80 { out.unicodeScalars.append(Unicode.Scalar(u)!) }
            else { out += String(format: "\\u%04x", u) }
        }
        return out
    }

    /// Decodes one line (without the newline).
    public static func decode(line: Data) throws -> WireMessage {
        guard let colon = line.firstIndex(of: UInt8(ascii: ":")) else { throw WireError.badFrame("no length") }
        guard let len = Int(String(decoding: line[line.startIndex..<colon], as: UTF8.self)) else {
            throw WireError.badFrame("bad length")
        }
        let body = line[line.index(after: colon)...]
        guard body.count == len else { throw WireError.badFrame("length \(body.count) != \(len)") }
        // Older Espruino builds wrote \xHH escapes, which are not JSON.
        var text = String(decoding: body, as: UTF8.self)
        if text.contains("\\x") { text = text.replacingOccurrences(of: "\\x", with: "\\u00") }
        do { return try JSONDecoder().decode(WireMessage.self, from: Data(text.utf8)) }
        catch { throw WireError.badFrame("json") }
    }
}

/// Reassembles notifications into lines. Reset it on every new connection.
public struct FrameAssembler: Sendable {
    private var buffer = Data()
    public static let maxBuffered = 64 * 1024
    public init() {}

    /// Feed one notification; returns any complete lines.
    public mutating func feed(_ chunk: Data) -> [Data] {
        buffer.append(chunk)
        var lines: [Data] = []
        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<nl]
            if !line.isEmpty { lines.append(Data(line)) }
            buffer = Data(buffer[buffer.index(after: nl)...])
        }
        if buffer.count > Self.maxBuffered { buffer.removeAll() }
        return lines
    }

    public mutating func reset() { buffer.removeAll() }
    public var pendingBytes: Int { buffer.count }
}
