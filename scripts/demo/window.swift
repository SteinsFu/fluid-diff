// Usage: swift window.swift <pid>
// Parks the cursor in the screen corner so it stays out of the shot, then prints
// "<window-id> <x> <y> <width> <height> <scale>" for the pid's main window: the id for
// `screencapture -l`, the frame in screen points for input.swift, and the main display's
// pixels per point, to crop the screen recording.
import CoreGraphics
import Foundation

let pid = Int(CommandLine.arguments[1])!
CGWarpMouseCursorPosition(CGPoint(x: 2, y: 2))
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for w in windows where w[kCGWindowOwnerPID as String] as? Int == pid {
    let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
    if (b["Height"] ?? 0) >= 400, let id = w[kCGWindowNumber as String] as? Int {
        let mode = CGDisplayCopyDisplayMode(CGMainDisplayID())!
        print(id, Int(b["X"]!), Int(b["Y"]!), Int(b["Width"]!), Int(b["Height"]!), mode.pixelWidth / mode.width)
        exit(0)
    }
}
exit(1)
