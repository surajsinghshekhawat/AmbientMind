import AppKit
import Carbon.HIToolbox

/// Global hotkeys that report release as well as press, which Electron's
/// globalShortcut cannot, so a held shortcut can mean "talk while held".
/// Carbon hotkeys need no permission: they fire only for the exact keys
/// registered, so nothing else typed is ever seen.
final class Hotkeys {
  static let shared = Hotkeys()
  private var refs: [UInt32: EventHotKeyRef] = [:]
  private var names: [UInt32: String] = [:]
  private var nextId: UInt32 = 1
  private var handler: EventHandlerRef?
  private static let signature: OSType = 0x414D_4844 // 'AMHD'

  /// Registers (or replaces) the hotkey called `name`. Runs on the main thread.
  func set(name: String, keyCode: UInt32, modifiers: UInt32) -> Result<Any, HelperError> {
    installHandler()
    clear(name: name)
    let id = nextId
    nextId += 1
    var ref: EventHotKeyRef?
    let status = RegisterEventHotKey(keyCode, modifiers, EventHotKeyID(signature: Self.signature, id: id), GetEventDispatcherTarget(), 0, &ref)
    guard status == noErr, let ref else {
      return .failure(HelperError(
        status == eventHotKeyExistsErr ? "in_use" : "register_failed",
        status == eventHotKeyExistsErr ? "Another app is using these keys" : "Could not register the shortcut (\(status))"
      ))
    }
    refs[id] = ref
    names[id] = name
    return .success(["name": name])
  }

  func clear(name: String) {
    for (id, existing) in names where existing == name {
      if let ref = refs[id] { UnregisterEventHotKey(ref) }
      refs[id] = nil
      names[id] = nil
    }
  }

  private func installHandler() {
    guard handler == nil else { return }
    var types = [
      EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
      EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
    ]
    InstallEventHandler(GetEventDispatcherTarget(), { _, event, _ -> OSStatus in
      guard let event else { return OSStatus(eventNotHandledErr) }
      var hotKey = EventHotKeyID()
      let status = GetEventParameter(
        event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
        MemoryLayout<EventHotKeyID>.size, nil, &hotKey
      )
      guard status == noErr, hotKey.signature == Hotkeys.signature, let name = Hotkeys.shared.names[hotKey.id] else {
        return OSStatus(eventNotHandledErr)
      }
      let phase = GetEventKind(event) == UInt32(kEventHotKeyPressed) ? "down" : "up"
      Output.shared.event("hotkey", ["name": name, "phase": phase])
      return noErr
    }, types.count, &types, nil, &handler)
  }
}
