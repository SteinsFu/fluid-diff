// Real mouse and keyboard input for the demo GIFs.
//
//   swift input.swift cursor <out.png>
//       Writes the macOS arrow cursor at its largest size and prints
//       "<hotspot-x> <hotspot-y> <width>" in points.
//   swift input.swift play <scene.json> <pid> <window-x> <window-y> <events.jsonl>
//       Plays a scene into the demo window and logs what happened, with epoch-ms
//       timestamps, so compose.py can draw the cursor and zoom in sync with the frames.
//
// Scene steps use points relative to the window's top-left corner:
//   {"at": [x, y]}                     put the cursor there
//   {"move": [x, y], "ms": 600}        glide the cursor there
//   {"click": "left" | "right", "mods": ["cmd"]}
//   {"keys": "cmd+shift+p"}            key combo, shown as a badge in the GIF
//   {"type": "text", "ms": 70}         type text, one key per `ms`
//   {"scroll": 1200, "ms": 1500}       wheel-scroll down by that many pixels (negative: up)
//   {"wait": 800}
//   {"zoom": [x, y, scale]}            camera hint only; scale 1 shows the whole window
//
// Needs Accessibility permission for the terminal app. Refuses to play unless the
// demo window is frontmost, so stray clicks can't land in another app.
import AppKit
import Foundation

let args = CommandLine.arguments

if args[1] == "cursor" {
    _ = NSApplication.shared  // NSCursor images are empty until AppKit is up
    let cursor = NSCursor.arrow
    let rep = cursor.image.representations.compactMap { $0 as? NSBitmapImageRep }.max { $0.pixelsWide < $1.pixelsWide }!
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
    print(cursor.hotSpot.x, cursor.hotSpot.y, cursor.image.size.width)
    exit(0)
}

let steps = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[2]))) as! [[String: Any]]
let pid = pid_t(args[3])!
let origin = CGPoint(x: Double(args[4])!, y: Double(args[5])!)
FileManager.default.createFile(atPath: args[6], contents: nil)
let log = FileHandle(forWritingAtPath: args[6])!

func emit(_ entry: [String: Any]) {
    var e = entry
    e["t"] = Date().timeIntervalSince1970 * 1000
    log.write(try! JSONSerialization.data(withJSONObject: e))
    log.write("\n".data(using: .utf8)!)
}

NSRunningApplication(processIdentifier: pid)?.activate()
usleep(500_000)
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
    fputs("demo window is not frontmost, refusing to send input\n", stderr)
    exit(1)
}

var pos = CGPoint(x: 0, y: 0)
let screen = { (p: CGPoint) in CGPoint(x: origin.x + p.x, y: origin.y + p.y) }
let modFlags: [String: CGEventFlags] = ["cmd": .maskCommand, "shift": .maskShift, "alt": .maskAlternate, "ctrl": .maskControl]
let modSymbols: [(String, String)] = [("ctrl", "⌃"), ("alt", "⌥"), ("shift", "⇧"), ("cmd", "⌘")]
let keyCodes: [String: (CGKeyCode, String)] = ["p": (35, "P"), "enter": (36, "↩"), "escape": (53, "esc"), "down": (125, "↓")]

func flags(_ mods: [String]) -> CGEventFlags { mods.reduce(into: CGEventFlags()) { $0.insert(modFlags[$1]!) } }

func mouse(_ type: CGEventType, _ button: CGMouseButton, _ f: CGEventFlags = []) {
    let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: screen(pos), mouseButton: button)!
    e.flags = f
    e.post(tap: .cghidEventTap)
}

func key(_ code: CGKeyCode, _ f: CGEventFlags = [], text: String? = nil) {
    for down in [true, false] {
        let e = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)!
        e.flags = f
        if let text = text {
            let units = Array(text.utf16)
            e.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        }
        e.post(tap: .cghidEventTap)
        usleep(12_000)
    }
}

func point(_ v: Any?) -> CGPoint {
    let a = v as! [Double]
    return CGPoint(x: a[0], y: a[1])
}

for step in steps {
    if step["at"] != nil {
        pos = point(step["at"])
        mouse(.mouseMoved, .left)
        emit(["cursor": [pos.x, pos.y]])
    } else if step["move"] != nil {
        let from = pos, to = point(step["move"])
        let n = max(1, (step["ms"] as? Int ?? 600) / 16)
        for i in 1...n {
            let t = Double(i) / Double(n)
            let k = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
            pos = CGPoint(x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k)
            mouse(.mouseMoved, .left)
            emit(["cursor": [pos.x, pos.y]])
            usleep(16_000)
        }
    } else if let button = step["click"] as? String {
        let f = flags(step["mods"] as? [String] ?? [])
        let right = button == "right"
        mouse(right ? .rightMouseDown : .leftMouseDown, right ? .right : .left, f)
        usleep(70_000)
        mouse(right ? .rightMouseUp : .leftMouseUp, right ? .right : .left, f)
        emit(["click": [pos.x, pos.y]])
    } else if let combo = step["keys"] as? String {
        let parts = combo.split(separator: "+").map(String.init)
        let mods = Array(parts.dropLast())
        let (code, label) = keyCodes[parts.last!]!
        emit(["keys": modSymbols.filter { mods.contains($0.0) }.map { $0.1 }.joined() + label])
        key(code, flags(mods))
    } else if let text = step["type"] as? String {
        for ch in text {
            key(0, text: String(ch))
            usleep(UInt32((step["ms"] as? Int ?? 70) * 1000))
        }
    } else if let dy = step["scroll"] as? Double {
        let n = max(1, (step["ms"] as? Int ?? 1500) / 16)
        var done = 0.0
        for i in 1...n {
            let t = Double(i) / Double(n)
            let target = dy * (t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2)
            let d = Int32((target - done).rounded())
            done += Double(d)
            // wheel1 > 0 scrolls up
            let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -d, wheel2: 0, wheel3: 0)!
            e.location = screen(pos)
            e.post(tap: .cghidEventTap)
            usleep(16_000)
        }
    } else if let ms = step["wait"] as? Int {
        usleep(UInt32(ms * 1000))
    } else if let z = step["zoom"] as? [Double] {
        emit(["zoom": z])
    }
}
emit(["end": true])
