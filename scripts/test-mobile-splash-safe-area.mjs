import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const res='apps/mobile/android/app/src/main/res/';
const xml=await readFile(res+'drawable/shensi_splash_icon.xml','utf8');
const styles=await readFile(res+'values/styles.xml','utf8');
assert.match(styles,/<item name="windowSplashScreenAnimatedIcon">@drawable\/shensi_splash_icon<\/item>/);
assert(!styles.includes('windowSplashScreenIconBackgroundColor'),'The no-background 288/192dp contract must remain selected');
assert.match(xml,/android:width="288dp" android:height="288dp"/);
assert.match(xml,/android:width="128dp" android:height="128dp" android:gravity="center"/);
assert.match(xml,/<bitmap android:src="@drawable\/shensi_logo" android:gravity="fill" android:filter="true"/);
assert.match(xml,/<solid android:color="#00000000"/);
for(const density of [0.75,1,1.5,2,2.625,3,3.5,4]){
 const half=Math.ceil(128*density)/2,safeRadius=192*density/2;
 assert(Math.hypot(half,half)+1<safeRadius,'Complete logo square must fit inside the splash mask at density '+density);
}
const hash=b=>createHash('sha256').update(b).digest('hex'),original=hash(await readFile('packages/ui/tray-icon.png'));
assert.equal(hash(await readFile(res+'drawable-nodpi/shensi_logo.png')),original);
assert.equal(hash(await readFile(res+'mipmap-nodpi/shensi_launcher.png')),original);
assert.match(await readFile(res+'drawable/shensi_splash.xml','utf8'),/android:width="120dp" android:height="120dp" android:gravity="center" android:drawable="@drawable\/shensi_logo"/);
console.log('PASS native splash uses a centered 128dp complete logo within the 288dp/192dp mask, all 8 densities safe; original logo, launcher and legacy 120dp fallback unchanged');
