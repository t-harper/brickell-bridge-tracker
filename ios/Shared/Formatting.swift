import Foundation

public enum Formatting {
    public static func duration(_ sec: Int) -> String {
        if sec < 60 { return "\(sec)s" }
        let m = sec / 60
        if m < 60 { return "\(m)m \(sec % 60)s" }
        let h = m / 60
        return "\(h)h \(m % 60)m"
    }

    public static let relativeDateFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    public static func relative(_ date: Date) -> String {
        relativeDateFormatter.localizedString(for: date, relativeTo: Date())
    }
}
