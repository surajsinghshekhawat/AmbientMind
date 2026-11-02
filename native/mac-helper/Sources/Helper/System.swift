import AppKit
import Contacts
import CoreAudio
import CoreGraphics

/// Whether now is a bad moment to interrupt: in a call, presenting, or away.
enum SystemState {
  static func busy() -> [String: Any] {
    // C enums accept any raw value; ~0 is kCGAnyInputEventType.
    let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    return [
      "idleSeconds": idle.isFinite ? idle : 0,
      "micInUse": micInUse(),
      "fullscreenApp": json(fullscreenApp()),
    ]
  }

  /// Any process recording from the default input, which is what a call looks like.
  static func micInUse() -> Bool {
    var device = AudioObjectID(0)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDefaultInputDevice,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr,
      device != 0
    else { return false }
    var running: UInt32 = 0
    size = UInt32(MemoryLayout<UInt32>.size)
    address.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
    guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &running) == noErr else { return false }
    return running != 0
  }

  /// The frontmost app when one of its windows covers a whole display.
  static func fullscreenApp() -> String? {
    guard let app = Activation.shared.frontmost(excluding: [getppid()]),
      let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    else { return nil }
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &displays, &count)
    let screens = displays.map { CGDisplayBounds($0) }
    for info in list where (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier {
      guard let rect = info[kCGWindowBounds as String] as? [String: Double] else { continue }
      let frame = CGRect(x: rect["X"] ?? 0, y: rect["Y"] ?? 0, width: rect["Width"] ?? 0, height: rect["Height"] ?? 0)
      if screens.contains(where: { $0.equalTo(frame) }) { return app.bundleIdentifier ?? app.localizedName }
    }
    return nil
  }
}

/// Who "me" is, so the model knows which person in a thread is the user.
enum MeCard {
  static func me() -> [String: Any] {
    var name = NSFullUserName()
    var emails: [String] = []
    var source = "account"
    if CNContactStore.authorizationStatus(for: .contacts) == .authorized {
      let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactEmailAddressesKey] as [CNKeyDescriptor]
      if let card = try? CNContactStore().unifiedMeContactWithKeys(toFetch: keys) {
        let full = [card.givenName, card.familyName].filter { !$0.isEmpty }.joined(separator: " ")
        if !full.isEmpty { name = full }
        emails = card.emailAddresses.map { $0.value as String }
        source = "contacts"
      }
    }
    return ["name": name, "emails": emails, "source": source]
  }
}
