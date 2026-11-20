import Capacitor
import Foundation
import Security

public func registerShensiPlugins(on bridge: CAPBridgeProtocol?) {
    for plugin in [NotebookPlugin(), MetadataPlugin(), VaultPlugin(), MediaPlugin(), CloudPlugin(), UserAPIPlugin()] as [CAPPlugin] {
        bridge?.registerPluginInstance(plugin)
    }
}

struct LocalFailure: LocalizedError {
    let message: String
    let code: String
    var errorDescription: String? { message }
    init(_ message: String, _ code: String = "NATIVE_FAILED") { self.message = message; self.code = code }
}

let fileQueue = DispatchQueue(label: "studio.hexing.shensi.files")
class LocalPlugin: CAPPlugin {
    func authorize(_ call: CAPPluginCall, _ body: @escaping () -> Void) {
        DispatchQueue.main.async {
            guard let url = self.bridge?.webView?.url, url.scheme == "capacitor", url.host == "localhost",
                  url.port == nil, url.user == nil, url.password == nil else {
                call.reject("原生能力仅允许随包本地页面使用", "UNTRUSTED_ORIGIN"); return
            }
            body()
        }
    }
    func perform(_ call: CAPPluginCall, _ body: @escaping () throws -> [String: Any]) {
        authorize(call) {
            fileQueue.async {
                do { call.resolve(try body()) }
                catch let e as LocalFailure { call.reject(e.message, e.code) }
                catch { call.reject("无法完成本地操作，请核对原记录", "STORAGE_FAILED") }
            }
        }
    }
}

func directory(_ name: String) throws -> URL {
    let fm = FileManager.default
    var url = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent(name, isDirectory: true)
    try fm.createDirectory(at: url, withIntermediateDirectories: true)
    var flags = URLResourceValues()
    flags.isExcludedFromBackup = true
    try url.setResourceValues(flags)
    return url
}

func valid(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
}

class RecordPlugin: LocalPlugin {
    var group: String { "notebooks" }
    var limit: Int { 64 << 20 }
    func location(_ call: CAPPluginCall) throws -> URL {
        guard let key = call.getString("key"), valid(key, "[A-Za-z0-9][A-Za-z0-9_-]{0,99}") else {
            throw LocalFailure("无效存储身份", "INVALID_STORAGE_KEY")
        }
        return try directory(group).appendingPathComponent(key).appendingPathExtension("json")
    }
    func row(_ url: URL) throws -> [String: Any] {
        guard FileManager.default.fileExists(atPath: url.path) else { return ["revision": 0, "value": NSNull()] }
        let bytes = try Data(contentsOf: url)
        guard let item = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              item["revision"] is Int, item["value"] is String else { throw LocalFailure("记录无法读取") }
        return item
    }
    @objc func read(_ call: CAPPluginCall) {
        perform(call) { try self.row(self.location(call)) }
    }
    @objc func list(_ call: CAPPluginCall) {
        perform(call) {
            let urls = try FileManager.default.contentsOfDirectory(at: directory(self.group), includingPropertiesForKeys: nil)
            return ["keys": urls.filter { $0.pathExtension == "json" }.map { $0.deletingPathExtension().lastPathComponent }.sorted()]
        }
    }
    @objc func compareAndSwap(_ call: CAPPluginCall) {
        perform(call) {
            let url = try self.location(call)
            guard let raw = call.options["expectedRevision"] as? NSNumber,
                  CFGetTypeID(raw) != CFBooleanGetTypeID(), let revision = Int(exactly: raw.doubleValue),
                  revision >= 0, revision < 9_007_199_254_740_991,
                  let value = call.getString("value"), value.utf8.count <= self.limit,
                  (try? JSONSerialization.jsonObject(with: Data(value.utf8))) is [String: Any] else {
                throw LocalFailure("事务版本或内容无效", "INVALID_TRANSACTION")
            }
            guard (try self.row(url))["revision"] as? Int == revision else {
                throw LocalFailure("记录已变化，请重新读取", self.group == "notebooks" ? "WORKSPACE_STATE_CONFLICT" : "METADATA_CONFLICT")
            }
            let saved: [String: Any] = ["revision": revision + 1, "value": value]
            try JSONSerialization.data(withJSONObject: saved).write(to: url, options: [.atomic, .completeFileProtection])
            return try self.row(url)
        }
    }
}
func method(_ name: String) -> CAPPluginMethod { CAPPluginMethod(name: name, returnType: CAPPluginReturnPromise) }
@objc(NotebookPlugin) class NotebookPlugin: RecordPlugin, CAPBridgedPlugin {
    let identifier = "NotebookPlugin", jsName = "ShensiStorage"
    let pluginMethods = ["read", "compareAndSwap", "list"].map(method)
}
@objc(MetadataPlugin) class MetadataPlugin: RecordPlugin, CAPBridgedPlugin {
    let identifier = "MetadataPlugin", jsName = "ShensiMetadata"
    let pluginMethods = ["read", "compareAndSwap"].map(method)
    override var group: String { "metadata" }
    override var limit: Int { 4 << 20 }
}
@objc(VaultPlugin) class VaultPlugin: LocalPlugin, CAPBridgedPlugin {
    let identifier = "VaultPlugin", jsName = "ShensiSecureVault"
    let pluginMethods = ["get", "set", "remove"].map(method)
    func query(_ call: CAPPluginCall) throws -> [String: Any] {
        guard let name = call.getString("key"), !name.isEmpty, name.utf8.count <= 512,
              name.rangeOfCharacter(from: .controlCharacters) == nil else { throw LocalFailure("无效凭据名称") }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "studio.hexing.shensi.mobile.vault", kSecAttrAccount as String: name]
    }
    @objc func get(_ call: CAPPluginCall) {
        perform(call) {
            var query = try self.query(call); query[kSecReturnData as String] = true
            var item: CFTypeRef?
            let result = SecItemCopyMatching(query as CFDictionary, &item)
            if result == errSecItemNotFound { return ["value": NSNull()] }
            guard result == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else { throw LocalFailure("凭据无法读取") }
            return ["value": value]
        }
    }
    @objc func set(_ call: CAPPluginCall) {
        perform(call) {
            let query = try self.query(call)
            guard let value = call.getString("value"), value.utf8.count <= 65536 else { throw LocalFailure("凭据长度无效") }
            let attrs: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
            var status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
            if status == errSecItemNotFound { status = SecItemAdd(query.merging(attrs) { _, v in v } as CFDictionary, nil) }
            guard status == errSecSuccess else { throw LocalFailure("系统凭据保存失败") }
            return [:]
        }
    }
    @objc func remove(_ call: CAPPluginCall) {
        perform(call) {
            let status = SecItemDelete(try self.query(call) as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw LocalFailure("系统凭据清理失败") }
            return [:]
        }
    }
}
