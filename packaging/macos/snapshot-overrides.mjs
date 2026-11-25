import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {assertPublicText,assertPublicInput} from '../../scripts/release-privacy-policy.mjs';
const files=['packages/core/src/account-service-endpoints.mjs','packages/ui/ui-glyph.js','packages/ui/app.js','packages/ui/book-picker.js','packages/ui/recycle-bin.js','packages/ui/editor-colors.js','packages/ui/generation-picker.js','packages/ui/media-ui.js','packages/ui/chat-layout.js','packages/ui/selection-edit.js','packages/ui/writing-timer.js','packages/ui/original-icons.js','packages/ui/styles.css','packages/core/src/native-extensions.mjs','packages/core/src/public-extension-catalog.mjs'];
files.push('packages/thirdparty/speech-engine.mjs');
files.push('packages/ui/generation-settings.js','packages/ui/core-plugin-copy.js');
files.push('packages/official/catalog.mjs','packages/official/host.mjs','packages/official/selection-edits.mjs','packages/ui/plugin-presentation.js','packages/ui/settings.js','packages/ui/extensions.js','packages/ui/official-ui.js','packages/ui/tutorial.js');
files.push('packages/official/model-defaults.mjs','packages/official/chat.mjs','packages/official/agent.mjs','packages/core/src/service.mjs','packages/ui/card-model-defaults.js','packages/ui/canvas-model.js','packages/ui/card-duplicate.js','packages/ui/generation-sources.js','packages/ui/model-authorization-source.js','packages/ui/models-ui.js','packages/ui/model-verification.js');
files.push('packages/official/models.mjs','packages/official/model-verification.mjs','packages/official/dreamina-account-migration.mjs','packages/official/multimodal-account-migration.mjs','packages/ui/model-capabilities.js','packages/ui/task-model-picker.js','packages/ui/text-model-selection.js');
files.push('packages/ui/generation-parameters.js','packages/ui/generation-controls.js','packages/official/chushou-references.mjs','packages/ui/editor-colors.css','packages/official/legacy/server/agent-tool-output.mjs','packages/official/legacy/server/codex-workspace-tools.mjs','packages/official/legacy/server/shensi-codex-agent-runtime.mjs','packages/official/legacy/server/codex-provider-bridge.mjs');
files.push('packages/ui/model-external-browser.js','packages/ui/gpt-model-policy.js','packages/ui/model-catalog.js','packages/official/model-catalog.mjs','packages/official/legacy/server/opencode-agent-runner.mjs','packages/official/deepseek-api.mjs','packages/official/legacy/cli/deepseek-opencode-config.mjs');
files.push('packages/ui/account-auth.js','packages/ui/account-security.js');
files.push('packages/official/legacy/server/workbuddy-desktop-bridge.mjs');
files.push('apps/desktop/workspace-permissions.mjs','packages/ui/copy-text.js','packages/ui/directory-paths.js','packages/ui/storage-location-picker.js','packages/core/legacy/recycle-state.js','packages/official/chat-turns.mjs');
files.push('packages/ui/about-page.js','packages/ui/app-updates.js','packages/ui/localization.js','packages/ui/plugin-storage-settings.js','packages/ui/system-notices.js','packages/ui/membership-ui.js','packages/core/src/release-download.cjs','packages/core/src/update-service.mjs');
files.push('apps/desktop/doubao-driver.mjs','packages/thirdparty/doubao-tasks.mjs','packages/thirdparty/doubao-media.mjs','packages/ui/media-card-job.js','packages/core/legacy/model-presets.js','packages/official/legacy/model-presets.js','packages/official/legacy/server/external-cli-agent-runner.mjs');
files.push('apps/desktop/parser-browser.mjs','apps/desktop/music-file-transfer.mjs','apps/desktop/yunx-video-parser.mjs','packages/official/legacy/video-portal-automation.cjs');
files.push('resources/plugins/native-extension-trust.json');
files.push('packages/core/src/nutstore-delta.mjs','packages/mobile/nutstore-journal.mjs');
files.push('packages/thirdparty/doubao-account-policy.mjs','packages/thirdparty/doubao-page.mjs');
files.push('packages/official/chat-voice.mjs','packages/official/chat-voice-runtime.mjs','packages/official/chat-voice-payloads.json','packages/ui/chat-voice.js','packages/ui/chat-layout.css');
const manifest=[];
files.push('packages/ui/document-finder.js');
files.push('packages/official/task-skill-routing.mjs','packages/official/chat-completion.mjs','packages/official/knowledge.mjs','packages/official/skill-panel-knowledge.mjs','packages/official/legacy/server/codex-session-runner.mjs');
files.push('packages/official/legacy/cli/codex-image-app-server.mjs','packages/official/chushou-executor.mjs');
files.push('packages/ui/card-interactions.css','packages/ui/media-card-time.js','packages/ui/media-task-policy.js','packages/core/src/plugin-marketplace.mjs',
 'packages/official/generation-models.mjs','packages/official/media.mjs','packages/official/membership.mjs','packages/official/legacy/dreamina-image-options.js',
 'packages/thirdparty/map-workshop.mjs','packages/mobile/account-client.mjs','packages/mobile/cloud-sync-client.mjs','packages/mobile/marketplace-client.mjs','packages/mobile/network.mjs');
for(const path of new Set(files)){assertPublicInput(path);const bytes=await readFile(path);assertPublicText(bytes.toString('utf8'),path);const destination=join('packaging/macos/overrides',path);await mkdir(dirname(destination),{recursive:true});await copyFile(path,destination);manifest.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile('packaging/macos/overrides.json',JSON.stringify(manifest,null,2)+'\n');
await copyFile('scripts/lib/browser-theme-acceptance.mjs','packaging/macos/browser-theme-acceptance.mjs');
console.log(JSON.stringify({reviewedFiles:manifest.length}));
