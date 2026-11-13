import Foundation
import Capacitor
import CloudKit

/// The vault backup as one record in the private CloudKit database. The
/// method names and `jsName` are `ICloudFilePlugin` in `src/definitions.ts`.
///
/// The private database belongs to the person's iCloud account: only this
/// app, signed in as them, can read it, and the app never sees whose
/// account it is. The record holds ciphertext.
@objc(ICloudFilePlugin)
public class ICloudFilePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ICloudFilePlugin"
    public let jsName = "ICloudFile"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    static let containerIdentifier = "iCloud.app.gleamwallet"
    /// TestFlight and App Store builds use the Production environment, which
    /// knows this type only once the schema is deployed from the CloudKit
    /// console (VAULT_BACKUP.md).
    static let recordType = "VaultBackup"
    /// One record in the default zone, under a fixed name, so every device
    /// on the account reads and writes the same one.
    static let recordName = "vault"
    /// An asset rather than a bytes field: a record's own fields stop at
    /// 1 MB, and a backup may be larger.
    static let fileField = "file"

    private let container = CKContainer(identifier: ICloudFilePlugin.containerIdentifier)
    private var database: CKDatabase { container.privateCloudDatabase }
    private let recordID = CKRecord.ID(recordName: ICloudFilePlugin.recordName)

    @objc func available(_ call: CAPPluginCall) {
        Task {
            let status = try? await container.accountStatus()
            call.resolve(["available": status == .available])
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        Task {
            do {
                let record = try await database.record(for: recordID)
                let modifiedAt = (record.modificationDate ?? Date()).timeIntervalSince1970 * 1000
                // A record without its file can't be a backup: empty bytes read as unreadable.
                guard let asset = record[Self.fileField] as? CKAsset, let url = asset.fileURL else {
                    call.resolve(["data": "", "modifiedAt": modifiedAt])
                    return
                }
                let data = try Data(contentsOf: url)
                call.resolve(["data": data.base64EncodedString(), "modifiedAt": modifiedAt])
            } catch let error as CKError where error.code == .unknownItem {
                call.resolve([:])
            } catch {
                reject(call, error)
            }
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
            call.reject("data must be base64")
            return
        }
        Task {
            // CKAsset uploads from a file. It is ciphertext, and goes once the save returns.
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                try data.write(to: url, options: [.atomic, .completeFileProtection])
                let record = CKRecord(recordType: Self.recordType, recordID: recordID)
                record[Self.fileField] = CKAsset(fileURL: url)
                // `.allKeys` replaces whatever the server has, so a fresh record
                // object overwrites another device's write without its change tag.
                let (saved, _) = try await database.modifyRecords(saving: [record], deleting: [], savePolicy: .allKeys)
                if case .failure(let error) = saved[recordID] { throw error }
                call.resolve()
            } catch {
                reject(call, error)
            }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        Task {
            do {
                _ = try await database.deleteRecord(withID: recordID)
                call.resolve()
            } catch let error as CKError where error.code == .unknownItem {
                call.resolve()
            } catch {
                reject(call, error)
            }
        }
    }

    /// The codes are `CLOUD_ERROR` in `src/definitions.ts`.
    private func reject(_ call: CAPPluginCall, _ error: Error) {
        switch (error as? CKError)?.code {
        case .notAuthenticated, .accountTemporarilyUnavailable:
            call.reject("No iCloud account is available", "NOT_SIGNED_IN", error)
        default:
            call.reject("Couldn't reach iCloud", "UNREACHABLE", error)
        }
    }
}
