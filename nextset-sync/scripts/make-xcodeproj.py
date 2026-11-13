#!/usr/bin/env python3
"""Writes ios/nextset-sync.xcodeproj (project + shared scheme).

Xcode 16+ format (objectVersion 77): the NextSetSync folder is a
synchronized group, so every Swift file in it is compiled without being
listed here. The core is a local Swift package (ios/NextSetSyncCore).
Re-run after changing build settings; never needed for adding files.
"""
from pathlib import Path

IOS = Path(__file__).resolve().parent.parent / "ios"
BUNDLE_ID = "com.zaffuto.nextsetsync"
I = {k: "4E53" + format(n, "020X") for n, k in enumerate([
    "project", "buildfile_core", "productdep_core", "app_ref", "plist_ref", "ent_ref", "sync_group",
    "frameworks", "main_group", "products", "config_group", "target", "sources", "resources",
    "proj_cfgs", "proj_debug", "proj_release", "tgt_cfgs", "tgt_debug", "tgt_release", "pkg_ref"], start=1)}
assert all(len(v) == 24 for v in I.values())

common = {
    "ALWAYS_SEARCH_USER_PATHS": "NO", "CLANG_ENABLE_MODULES": "YES", "CLANG_ENABLE_OBJC_ARC": "YES",
    "COPY_PHASE_STRIP": "NO", "ENABLE_STRICT_OBJC_MSGSEND": "YES", "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17", "IPHONEOS_DEPLOYMENT_TARGET": "17.0", "LOCALIZATION_PREFERS_STRING_CATALOGS": "YES",
    "SDKROOT": "iphoneos", "SWIFT_VERSION": "5.0",
}
debug = {**common, "DEBUG_INFORMATION_FORMAT": "dwarf", "ENABLE_TESTABILITY": "YES", "GCC_OPTIMIZATION_LEVEL": "0",
         "ONLY_ACTIVE_ARCH": "YES", "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "\"DEBUG $(inherited)\"",
         "SWIFT_OPTIMIZATION_LEVEL": "\"-Onone\"", "MTL_ENABLE_DEBUG_INFO": "INCLUDE_SOURCE"}
release = {**common, "DEBUG_INFORMATION_FORMAT": "\"dwarf-with-dsym\"", "ENABLE_NS_ASSERTIONS": "NO",
           "SWIFT_COMPILATION_MODE": "wholemodule", "VALIDATE_PRODUCT": "YES", "MTL_ENABLE_DEBUG_INFO": "NO"}
target = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1", "DEVELOPMENT_TEAM": "\"\"", "ENABLE_PREVIEWS": "YES",
    "GENERATE_INFOPLIST_FILE": "NO", "INFOPLIST_FILE": "config/info.plist",
    "LD_RUNPATH_SEARCH_PATHS": "(\n\t\t\t\t\t\"$(inherited)\",\n\t\t\t\t\t\"@executable_path/Frameworks\",\n\t\t\t\t)",
    "MARKETING_VERSION": "0.1.0", "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE_ID, "PRODUCT_NAME": "\"$(TARGET_NAME)\"",
    "SUPPORTED_PLATFORMS": "\"iphoneos iphonesimulator\"", "SUPPORTS_MACCATALYST": "NO",
    "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "NO", "SWIFT_EMIT_LOC_STRINGS": "YES", "TARGETED_DEVICE_FAMILY": "1",
}

def cfg(id_, name, settings):
    body = "".join(f"\t\t\t\t{k} = {v};\n" for k, v in sorted(settings.items()))
    return f"\t\t{id_} /* {name} */ = {{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {{\n{body}\t\t\t}};\n\t\t\tname = {name};\n\t\t}};\n"

pbx = f"""// !$*UTF8*$!
{{
	archiveVersion = 1;
	classes = {{
	}};
	objectVersion = 77;
	objects = {{

/* Begin PBXBuildFile section */
		{I['buildfile_core']} /* NextSetSyncCore in Frameworks */ = {{isa = PBXBuildFile; productRef = {I['productdep_core']} /* NextSetSyncCore */; }};
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		{I['app_ref']} /* NextSetSync.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = NextSetSync.app; sourceTree = BUILT_PRODUCTS_DIR; }};
		{I['plist_ref']} /* info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = info.plist; sourceTree = "<group>"; }};
/* End PBXFileReference section */

/* Begin PBXFileSystemSynchronizedRootGroup section */
		{I['sync_group']} /* NextSetSync */ = {{
			isa = PBXFileSystemSynchronizedRootGroup;
			path = NextSetSync;
			sourceTree = "<group>";
		}};
/* End PBXFileSystemSynchronizedRootGroup section */

/* Begin PBXFrameworksBuildPhase section */
		{I['frameworks']} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{I['buildfile_core']} /* NextSetSyncCore in Frameworks */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		{I['main_group']} = {{
			isa = PBXGroup;
			children = (
				{I['sync_group']} /* NextSetSync */,
				{I['config_group']} /* config */,
				{I['products']} /* Products */,
			);
			sourceTree = "<group>";
		}};
		{I['products']} /* Products */ = {{
			isa = PBXGroup;
			children = (
				{I['app_ref']} /* NextSetSync.app */,
			);
			name = Products;
			sourceTree = "<group>";
		}};
		{I['config_group']} /* config */ = {{
			isa = PBXGroup;
			children = (
				{I['plist_ref']} /* info.plist */,
			);
			path = config;
			sourceTree = "<group>";
		}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		{I['target']} /* NextSetSync */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {I['tgt_cfgs']} /* Build configuration list for PBXNativeTarget "NextSetSync" */;
			buildPhases = (
				{I['sources']} /* Sources */,
				{I['frameworks']} /* Frameworks */,
				{I['resources']} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			fileSystemSynchronizedGroups = (
				{I['sync_group']} /* NextSetSync */,
			);
			name = NextSetSync;
			packageProductDependencies = (
				{I['productdep_core']} /* NextSetSyncCore */,
			);
			productName = NextSetSync;
			productReference = {I['app_ref']} /* NextSetSync.app */;
			productType = "com.apple.product-type.application";
		}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		{I['project']} /* Project object */ = {{
			isa = PBXProject;
			attributes = {{
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1600;
				LastUpgradeCheck = 1600;
				TargetAttributes = {{
					{I['target']} = {{
						CreatedOnToolsVersion = 16.0;
					}};
				}};
			}};
			buildConfigurationList = {I['proj_cfgs']} /* Build configuration list for PBXProject "nextset-sync" */;
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = {I['main_group']};
			minimizedProjectReferenceProxies = 1;
			packageReferences = (
				{I['pkg_ref']} /* XCLocalSwiftPackageReference "NextSetSyncCore" */,
			);
			preferredProjectObjectVersion = 77;
			productRefGroup = {I['products']} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				{I['target']} /* NextSetSync */,
			);
		}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		{I['resources']} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		{I['sources']} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
{cfg(I['proj_debug'], 'Debug', debug)}{cfg(I['proj_release'], 'Release', release)}{cfg(I['tgt_debug'], 'Debug', target)}{cfg(I['tgt_release'], 'Release', target)}/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		{I['proj_cfgs']} /* Build configuration list for PBXProject "nextset-sync" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{I['proj_debug']} /* Debug */,
				{I['proj_release']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{I['tgt_cfgs']} /* Build configuration list for PBXNativeTarget "NextSetSync" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{I['tgt_debug']} /* Debug */,
				{I['tgt_release']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
/* End XCConfigurationList section */

/* Begin XCLocalSwiftPackageReference section */
		{I['pkg_ref']} /* XCLocalSwiftPackageReference "NextSetSyncCore" */ = {{
			isa = XCLocalSwiftPackageReference;
			relativePath = NextSetSyncCore;
		}};
/* End XCLocalSwiftPackageReference section */

/* Begin XCSwiftPackageProductDependency section */
		{I['productdep_core']} /* NextSetSyncCore */ = {{
			isa = XCSwiftPackageProductDependency;
			productName = NextSetSyncCore;
		}};
/* End XCSwiftPackageProductDependency section */
	}};
	rootObject = {I['project']} /* Project object */;
}}
"""

scheme = f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{I['target']}" BuildableName = "NextSetSync.app" BlueprintName = "NextSetSync" ReferencedContainer = "container:nextset-sync.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES" shouldAutocreateTestPlan = "YES">
      <Testables>
         <TestableReference skipped = "NO">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "NextSetSyncCoreTests" BuildableName = "NextSetSyncCoreTests" BlueprintName = "NextSetSyncCoreTests" ReferencedContainer = "container:NextSetSyncCore">
            </BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{I['target']}" BuildableName = "NextSetSync.app" BlueprintName = "NextSetSync" ReferencedContainer = "container:nextset-sync.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{I['target']}" BuildableName = "NextSetSync.app" BlueprintName = "NextSetSync" ReferencedContainer = "container:nextset-sync.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
"""

proj = IOS / "nextset-sync.xcodeproj"
(proj / "xcshareddata" / "xcschemes").mkdir(parents=True, exist_ok=True)
(proj / "project.xcworkspace").mkdir(exist_ok=True)
(proj / "project.pbxproj").write_text(pbx)
(proj / "xcshareddata" / "xcschemes" / "NextSetSync.xcscheme").write_text(scheme)
(proj / "project.xcworkspace" / "contents.xcworkspacedata").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n<Workspace\n   version = "1.0">\n   <FileRef\n      location = "self:">\n   </FileRef>\n</Workspace>\n')
print("wrote", proj)
