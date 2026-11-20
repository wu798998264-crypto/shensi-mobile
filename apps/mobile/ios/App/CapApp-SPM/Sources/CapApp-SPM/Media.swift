import Capacitor
import CryptoKit
import Foundation

private struct MediaRecord: Codable {
    var id: String, name: String, kind: String, mime: String, sha256: String
    var bytes: Int
    var receipt: [String: Any] { ["id":id,"name":name,"kind":kind,"mime":mime,"bytes":bytes,"sha256":sha256] }
}
private struct ImportJob { var record: MediaRecord, dir: URL, offset = 0 }
@objc(MediaPlugin) class MediaPlugin: LocalPlugin, CAPBridgedPlugin {
    let identifier = "MediaPlugin", jsName = "ShensiMedia"
    let pluginMethods = ["begin","write","finish","abort","resolve","describe","read"].map(method)
    private let chunk = 256 * 1024
    private var jobs: [String: ImportJob] = [:]
    private let formats = ["png":"image/png","jpg":"image/jpeg","jpeg":"image/jpeg","gif":"image/gif","webp":"image/webp","mp4":"video/mp4","mov":"video/quicktime","webm":"video/webm","mp3":"audio/mpeg","m4a":"audio/mp4","wav":"audio/wav","ogg":"audio/ogg"]
    private let invalid = LocalFailure("附件身份、大小或内容无效", "MEDIA_INVALID")
    private func destination(_ id: String) throws -> URL {
        guard valid(id,"m-[a-f0-9-]{36}\\.(png|jpe?g|gif|webp|mp4|mov|webm|mp3|m4a|wav|ogg)") else { throw invalid }
        return try directory("whiteboard-media").appendingPathComponent(id, isDirectory: true)
    }
    private func load(_ id: String, verify: Bool = false) throws -> MediaRecord {
        let dir = try destination(id), file = dir.appendingPathComponent(id)
        let item = try JSONDecoder().decode(MediaRecord.self, from: Data(contentsOf: dir.appendingPathComponent("receipt.json")))
        guard item.id == id, try file.resourceValues(forKeys: [.fileSizeKey]).fileSize == item.bytes else { throw invalid }
        if verify { guard try digest(file) == item.sha256 else { throw invalid } }
        return item
    }
    private func digest(_ file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
        var hasher = SHA256()
        while let data = try handle.read(upToCount: chunk), !data.isEmpty { hasher.update(data: data) }
        return hasher.finalize().map { String(format:"%02x",$0) }.joined()
    }
    private func signature(_ data: Data, _ ext: String) -> Bool {
        let b = Array(data.prefix(12))
        func matches(_ string: String, _ at: Int = 0) -> Bool { b.dropFirst(at).starts(with:string.utf8) }
        switch ext {
        case "png": return b.starts(with:[137,80,78,71,13,10,26,10])
        case "jpg","jpeg": return b.starts(with:[255,216,255])
        case "gif": return matches("GIF87a") || matches("GIF89a")
        case "wav": return matches("RIFF") && matches("WAVE",8)
        case "webp": return matches("RIFF") && matches("WEBP",8)
        case "mp4","mov","m4a": return matches("ftyp",4)
        case "webm": return b.starts(with:[26,69,223,163])
        case "mp3": return matches("ID3") || b.count >= 2 && b[0] == 255 && (b[1] & 224) == 224
        case "ogg": return matches("OggS")
        default: return false
        }
    }
    @objc func begin(_ call: CAPPluginCall) {
        perform(call) {
            guard let name = call.getString("name"), !name.trimmingCharacters(in:.whitespaces).isEmpty, name.count <= 200,
                  name.rangeOfCharacter(from: CharacterSet(charactersIn:"/\\").union(.controlCharacters)) == nil,
                  let bytes = call.getInt("bytes"), (1...(256 << 20)).contains(bytes), self.jobs.count < 20 else { throw self.invalid }
            let ext = (name as NSString).pathExtension.lowercased()
            guard let mime = self.formats[ext], let kind = mime.split(separator:"/").first else { throw self.invalid }
            let expected = call.getObject("expected"), id = expected?["id"] as? String ?? "m-" + UUID().uuidString.lowercased() + "." + ext
            let dest = try self.destination(id), hash = expected?["sha256"] as? String ?? ""
            guard self.jobs[id] == nil, dest.pathExtension == ext else { throw self.invalid }
            if let expected {
                guard expected["id"] as? String == id, expected["name"] as? String == name, expected["bytes"] as? Int == bytes,
                      expected["kind"] as? String == String(kind), expected["mime"] as? String == mime, valid(hash,"[0-9a-f]{64}") else { throw self.invalid }
            }
            if FileManager.default.fileExists(atPath:dest.path) {
                let saved = try self.load(id, verify:true)
                guard expected != nil, saved.sha256 == hash, saved.name == name, saved.bytes == bytes else { throw self.invalid }
                return ["id":id,"chunkBytes":self.chunk,"existing":true,"receipt":saved.receipt]
            }
            // A single directory rename publishes the immutable file and its receipt together.
            let dir = try directory("whiteboard-imports").appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:false)
            try Data().write(to:dir.appendingPathComponent(id),options:.completeFileProtection)
            self.jobs[id] = ImportJob(record: MediaRecord(id:id,name:name,kind:String(kind),mime:mime,sha256:hash,bytes:bytes),dir:dir)
            return ["id":id,"chunkBytes":self.chunk]
        }
    }
    @objc func write(_ call: CAPPluginCall) {
        perform(call) {
            guard let id = call.getString("id"), var job = self.jobs[id], call.getInt("offset") == job.offset,
                  let base64 = call.getString("base64"), base64.utf8.count <= (self.chunk+2)/3*4, let data = Data(base64Encoded:base64),
                  (1...self.chunk).contains(data.count), data.count <= job.record.bytes-job.offset,
                  job.offset > 0 || self.signature(data,(id as NSString).pathExtension) else { throw self.invalid }
            let handle = try FileHandle(forWritingTo:job.dir.appendingPathComponent(id)); defer { try? handle.close() }
            try handle.seek(toOffset:UInt64(job.offset)); try handle.write(contentsOf:data)
            job.offset += data.count; self.jobs[id] = job
            return ["written":job.offset]
        }
    }
    @objc func finish(_ call: CAPPluginCall) {
        perform(call) {
            let id = call.getString("id") ?? ""
            guard var job = self.jobs[id] else { return try self.load(id).receipt }
            guard job.offset == job.record.bytes else { throw self.invalid }
            let sha = try self.digest(job.dir.appendingPathComponent(id))
            guard job.record.sha256.isEmpty || sha == job.record.sha256 else { throw self.invalid }
            job.record.sha256 = sha
            try JSONEncoder().encode(job.record).write(to:job.dir.appendingPathComponent("receipt.json"),options:[.atomic,.completeFileProtection])
            try FileManager.default.moveItem(at:job.dir,to:self.destination(id)); self.jobs.removeValue(forKey:id)
            return try self.load(id).receipt
        }
    }
    @objc func abort(_ call: CAPPluginCall) {
        perform(call) {
            let id = call.getString("id") ?? ""
            guard let job = self.jobs[id] else { return ["cancelled":false] }
            try FileManager.default.removeItem(at:job.dir); self.jobs.removeValue(forKey:id)
            return ["cancelled":true]
        }
    }
    @objc func resolve(_ call: CAPPluginCall) {
        perform(call) {
            let item = try self.load(call.getString("id") ?? "")
            return ["url":try self.destination(item.id).appendingPathComponent(item.id).absoluteString]
        }
    }
    @objc func describe(_ call: CAPPluginCall) {
        perform(call) { try self.load(call.getString("id") ?? "", verify:true).receipt }
    }
    @objc func read(_ call: CAPPluginCall) {
        perform(call) {
            let item = try self.load(call.getString("id") ?? "")
            guard item.sha256 == call.getString("sha256"), let offset = call.getInt("offset"), offset >= 0,
                  let length = call.getInt("length"), (1...self.chunk).contains(length), offset <= item.bytes-length else { throw self.invalid }
            let handle = try FileHandle(forReadingFrom:self.destination(item.id).appendingPathComponent(item.id)); defer { try? handle.close() }
            try handle.seek(toOffset:UInt64(offset)); guard let data = try handle.read(upToCount:length), data.count == length else { throw self.invalid }
            return ["id":item.id,"offset":offset,"bytes":length,"sha256":item.sha256,"base64":data.base64EncodedString()]
        }
    }
}
