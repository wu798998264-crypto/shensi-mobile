import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const testPackageRoot=resolve(process.env.SHENSI_TEST_PACKAGE_ROOT||'.');
export const testPackagePath=path=>join(testPackageRoot,path);
export const testPackageUrl=path=>pathToFileURL(testPackagePath(path)).href;
export const testEvidencePath=fallback=>process.env.SHENSI_TEST_EVIDENCE_DIR||fallback;
