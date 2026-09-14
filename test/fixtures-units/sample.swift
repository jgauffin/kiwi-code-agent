import Foundation

struct Point: Equatable {
    var x: Int
    var total: Int {
        get { return x }
        set { x = newValue }
    }
}

final class Greeter {
    func greet(_ name: String) -> String {
        let raw = #"has "quotes" and { brace"#
        return "hi \(name.uppercased()) {"
    }

    init(x: Int) {
        if let y = Optional(x) {
            print(y)
        }
    }
}

extension Greeter {
    func bye() { print("bye") }
}
