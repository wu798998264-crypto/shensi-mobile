import Foundation
import Capacitor
import CryptoKit

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
private let network: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.timeoutIntervalForRequest = 30
    config.timeoutIntervalForResource = 90
    return URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
}()
private enum Channel { case artifact, nutstore, chunk, custom }
private func makeRequest(_ call: CAPPluginCall, _ channel: Channel) throws -> (URLRequest, Int) {
    let invalid = LocalFailure("请求地址、操作或参数无效")
    guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https",
          let host = url.host, url.user == nil, url.password == nil, url.fragment == nil else { throw invalid }
    var request = URLRequest(url: url)
    let verb = call.getString("method") ?? "GET"
    request.httpMethod = verb
    func data(_ limit: Int) throws -> Data {
        let base64 = call.getString("data") ?? ""
        guard base64.utf8.count <= ((limit + 2) / 3) * 4, let data = Data(base64Encoded: base64), data.count <= limit else { throw invalid }
        return data
    }
    let auth = call.getString("authorization") ?? ""
    switch channel {
    case .artifact:
        guard ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].contains(host), url.port == nil, verb == "GET" else { throw invalid }
        return (request, 2 << 20)
    case .custom:
        guard url.query == nil, (verb == "GET" && url.path.hasSuffix("/models")) || (verb == "POST" && url.path.hasSuffix("/chat/completions")),
              auth.isEmpty || (auth.hasPrefix("Bearer ") && auth.utf8.count <= 16391 && auth.rangeOfCharacter(from: .controlCharacters) == nil) else { throw invalid }
        if !auth.isEmpty { request.setValue(auth, forHTTPHeaderField: "Authorization") }
        if verb == "POST" {
            guard let body = call.getString("body"), body.count <= 150000 else { throw invalid }
            request.httpBody = Data(body.utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return (request, 2 << 20)
    case .nutstore:
        let dav = url.path.hasPrefix("/dav/") && ["OPTIONS","PROPFIND","MKCOL","GET","HEAD","PUT","DELETE"].contains(verb)
        let delta = ["/nsdav/delta","/nsdav/latestDeltaCursor"].contains(url.path) && verb == "POST"
        guard host == "dav.jianguoyun.com", url.port == nil, dav || delta, url.query == nil || verb == "PROPFIND",
              valid(auth, "Basic [A-Za-z0-9+/=]{1,4096}") else { throw invalid }
        request.setValue(auth, forHTTPHeaderField: "Authorization")
        let headers = call.getObject("headers") ?? [:]
        for name in ["Content-Type","Depth","If-Match","If-None-Match","Range"] {
            guard let value = headers[name] as? String else { continue }
            guard value.count <= 512, value.rangeOfCharacter(from: .controlCharacters) == nil else { throw invalid }
            request.setValue(value, forHTTPHeaderField: name)
        }
        let body = try data(8 << 20)
        if !body.isEmpty || ["PUT","PROPFIND"].contains(verb) {
            guard verb != "GET", verb != "HEAD" else { throw invalid }; request.httpBody = body
        }
        return (request, 8 << 20)
    case .chunk:
        let segment = verb == "PUT" ? "uploads" : "files"
        guard host == "api.hexing.studio", url.port == nil, url.query == nil, ["GET","PUT"].contains(verb),
              valid(url.path, "/v1/cloud-sync/" + segment + "/[a-zA-Z0-9_-]{1,128}/chunks/[0-9]{1,5}"),
              let token = call.getString("token"), valid(token, "[A-Za-z0-9._~+/=\\-]{1,16384}") else { throw invalid }
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if verb == "PUT" {
            let body = try data(4 << 20), digest = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
            guard digest == call.getString("sha256") else { throw invalid }
            request.httpBody = body
            request.setValue(digest, forHTTPHeaderField: "X-Content-SHA256")
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        }
        return (request, 4 << 20)
    }
}
private func fetch(_ plugin: LocalPlugin, _ call: CAPPluginCall, _ channel: Channel) {
    plugin.authorize(call) {
        Task {
            do {
                let (request, limit) = try makeRequest(call, channel)
                let (stream, response) = try await network.bytes(for: request)
                guard let http = response as? HTTPURLResponse else { throw LocalFailure("服务未返回有效响应") }
                let status = http.statusCode
                if (300..<400).contains(status) {
                    guard channel == .artifact else { throw LocalFailure("服务重定向已拒绝") }
                    call.resolve(["status": status, "location": http.value(forHTTPHeaderField: "Location") ?? "", "base64": ""]); return
                }
                guard request.httpMethod == "HEAD" || response.expectedContentLength <= Int64(limit) else { throw LocalFailure("响应过大") }
                var bytes = Data()
                for try await byte in stream {
                    guard bytes.count < limit else { throw LocalFailure("响应过大") }
                    bytes.append(byte)
                }
                if channel == .custom {
                    call.resolve(["status": status,"data": String(decoding: bytes, as: UTF8.self)]); return
                }
                var headers: [String: String] = [:]
                for name in ["Content-Type","Content-Length","ETag","Retry-After","Content-Range","Accept-Ranges","Link"] {
                    headers[name] = http.value(forHTTPHeaderField: name)
                }
                call.resolve(["status":status,"base64":bytes.base64EncodedString(),"headers":headers])
            } catch { call.reject("网络请求未确认，请核对原操作", "TRANSPORT_FAILED") }
        }
    }
}
@objc(CloudPlugin) class CloudPlugin: LocalPlugin, CAPBridgedPlugin {
    let identifier = "CloudPlugin", jsName = "ShensiCloudTransport"
    let pluginMethods = ["request","artifact","nutstore"].map(method)
    @objc func request(_ call: CAPPluginCall) { fetch(self, call, .chunk) }
    @objc func artifact(_ call: CAPPluginCall) { fetch(self, call, .artifact) }
    @objc func nutstore(_ call: CAPPluginCall) { fetch(self, call, .nutstore) }
}
@objc(UserAPIPlugin) class UserAPIPlugin: LocalPlugin, CAPBridgedPlugin {
    let identifier = "UserAPIPlugin", jsName = "ShensiCustomApi"
    let pluginMethods = [method("request")]
    @objc func request(_ call: CAPPluginCall) { fetch(self, call, .custom) }
}
