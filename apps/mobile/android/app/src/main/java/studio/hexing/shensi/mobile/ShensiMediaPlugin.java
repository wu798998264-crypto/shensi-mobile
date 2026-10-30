package studio.hexing.shensi.mobile;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** Private immutable media. No arbitrary paths, remote fetches, or public-storage permission. */
@CapacitorPlugin(name="ShensiMedia")
public class ShensiMediaPlugin extends ShensiLocalPlugin {
    private static final int CHUNK=256*1024;
    private final Map<String,JSObject> sessions=new HashMap<>();
    private File root() throws Exception { File r=new File(getContext().getFilesDir(),"whiteboard-media"); if(!r.isDirectory()&&!r.mkdirs())throw new Exception("无法创建附件目录");return r; }
    private File file(String id) throws Exception {
        if(id==null||!id.matches("m-[a-f0-9-]{36}\\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a|ogg)"))throw new Exception("无效附件身份");
        File r=root(),f=new File(r,id);if(!f.getCanonicalFile().getParentFile().equals(r.getCanonicalFile()))throw new Exception("附件路径无效");return f;
    }
    private long number(PluginCall call,String name) throws Exception { Object n=call.getData().opt(name);if(!(n instanceof Integer||n instanceof Long))throw new Exception("无效文件大小或偏移");return ((Number)n).longValue(); }
    private String[] format(String ext) throws Exception {
        switch(ext){
            case "png":return new String[]{"image","image/png"};case "jpg":case "jpeg":return new String[]{"image","image/jpeg"};case "gif":return new String[]{"image","image/gif"};case "webp":return new String[]{"image","image/webp"};
            case "mp4":return new String[]{"video","video/mp4"};case "mov":return new String[]{"video","video/quicktime"};case "webm":return new String[]{"video","video/webm"};
            case "mp3":return new String[]{"audio","audio/mpeg"};case "wav":return new String[]{"audio","audio/wav"};case "m4a":return new String[]{"audio","audio/mp4"};case "ogg":return new String[]{"audio","audio/ogg"};default:throw new Exception("不支持此媒体格式");
        }
    }
    private boolean ascii(byte[] b,int at,String text){return b.length>=at+text.length()&&new String(b,at,text.length(),StandardCharsets.US_ASCII).equals(text);}
    private boolean signature(byte[] b,String ext){
        switch(ext){
            case "png":return b.length>=8&&(b[0]&255)==137&&ascii(b,1,"PNG\r\n\u001a\n");
            case "jpg":case "jpeg":return b.length>=3&&(b[0]&255)==255&&(b[1]&255)==216&&(b[2]&255)==255;
            case "gif":return ascii(b,0,"GIF87a")||ascii(b,0,"GIF89a");case "webp":return ascii(b,0,"RIFF")&&ascii(b,8,"WEBP");case "wav":return ascii(b,0,"RIFF")&&ascii(b,8,"WAVE");
            case "mp4":case "mov":case "m4a":return ascii(b,4,"ftyp");case "webm":return b.length>=4&&(b[0]&255)==26&&(b[1]&255)==69&&(b[2]&255)==223&&(b[3]&255)==163;
            case "mp3":return ascii(b,0,"ID3")||b.length>=2&&(b[0]&255)==255&&(b[1]&224)==224;case "ogg":return ascii(b,0,"OggS");default:return false;
        }
    }
    private JSObject receipt(String id) throws Exception {
        File f=file(id),meta=new File(f.getPath()+".json");if(!meta.isFile()||meta.length()>4096)throw new Exception("附件记录不存在");
        JSObject r=new JSObject(new String(Files.readAllBytes(meta.toPath()),StandardCharsets.UTF_8));
        if(!r.getString("id").equals(id)||!f.isFile()||f.length()!=r.getLong("bytes"))throw new Exception("附件缺失或大小不一致");return r;
    }
    private void reject(PluginCall call,Exception e){call.reject(e.getMessage()==null?"附件操作失败，原资料保留":e.getMessage(),"MOBILE_MEDIA_FAILED");}
    @PluginMethod public synchronized void begin(PluginCall call){
        if(!trusted(call))return;
        try{
            String name=call.getString("name");long bytes=number(call,"bytes");
            if(name==null||name.trim().isEmpty()||name.length()>200||name.matches("(?s).*[\\\\/\\p{Cntrl}].*")||bytes<1||bytes>256L*1024*1024)throw new Exception("文件名无效、文件为空或超过256MiB");
            if(sessions.size()>=20)throw new Exception("导入任务过多");String ext=name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);String[] fmt=format(ext);String id="m-"+UUID.randomUUID()+"."+ext;
            if(!new File(file(id).getPath()+".part").createNewFile())throw new Exception("无法创建附件");
            JSObject r=new JSObject();r.put("id",id);r.put("name",name);r.put("bytes",bytes);r.put("ext",ext);r.put("kind",fmt[0]);r.put("mime",fmt[1]);r.put("written",0L);sessions.put(id,r);
            JSObject out=new JSObject();out.put("id",id);out.put("chunkBytes",CHUNK);call.resolve(out);
        }catch(Exception e){reject(call,e);}
    }
    @PluginMethod public synchronized void write(PluginCall call){
        if(!trusted(call))return;
        try{
            String id=call.getString("id"),encoded=call.getString("base64");file(id);JSObject s=sessions.get(id);if(s==null)throw new Exception("导入会话已失效");long offset=number(call,"offset");
            if(offset!=s.getLong("written"))throw new Exception("分块顺序不符，未重复写入");if(encoded==null||encoded.length()>((CHUNK+2)/3)*4||encoded.length()%4!=0||!encoded.matches("[A-Za-z0-9+/]+={0,2}"))throw new Exception("无效分块");
            byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);if(bytes.length<1||bytes.length>CHUNK||offset+bytes.length>s.getLong("bytes"))throw new Exception("分块大小不符");if(offset==0&&!signature(bytes,s.getString("ext")))throw new Exception("文件内容与扩展名不一致");
            try(RandomAccessFile f=new RandomAccessFile(file(id).getPath()+".part","rw")){f.seek(offset);f.write(bytes);}
            s.put("written",offset+bytes.length);JSObject out=new JSObject();out.put("written",offset+bytes.length);call.resolve(out);
        }catch(Exception e){reject(call,e);}
    }
    @PluginMethod public synchronized void finish(PluginCall call){
        if(!trusted(call))return;
        try{
            String id=call.getString("id");File finalFile=file(id);JSObject s=sessions.get(id);if(s==null){call.resolve(receipt(id));return;}
            File part=new File(finalFile.getPath()+".part");if(s.getLong("written")!=s.getLong("bytes")||part.length()!=s.getLong("bytes"))throw new Exception("附件尚未完整写入");
            MessageDigest digest=MessageDigest.getInstance("SHA-256");try(FileInputStream in=new FileInputStream(part)){byte[] buf=new byte[CHUNK];int n;while((n=in.read(buf))!=-1)digest.update(buf,0,n);}
            StringBuilder hex=new StringBuilder();for(byte b:digest.digest())hex.append(String.format(Locale.ROOT,"%02x",b&255));s.put("sha256",hex.toString());
            try(RandomAccessFile f=new RandomAccessFile(part,"rw")){f.getFD().sync();}if(finalFile.exists()||!part.renameTo(finalFile))throw new Exception("附件提交失败，未覆盖已有文件");
            JSObject r=new JSObject(s.toString());r.remove("ext");r.remove("written");File metaPart=new File(finalFile.getPath()+".json.part"),meta=new File(finalFile.getPath()+".json");
            try(FileOutputStream out=new FileOutputStream(metaPart)){out.write(r.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}if(!metaPart.renameTo(meta))throw new Exception("附件记录提交失败");sessions.remove(id);call.resolve(receipt(id));
        }catch(Exception e){reject(call,e);}
    }
    @PluginMethod public synchronized void abort(PluginCall call){
        if(!trusted(call))return;try{String id=call.getString("id");File f=file(id);boolean found=sessions.containsKey(id);if(found){File part=new File(f.getPath()+".part");if(part.exists()&&!part.delete())throw new Exception("无法清理未完成分块");sessions.remove(id);}JSObject r=new JSObject();r.put("cancelled",found);call.resolve(r);}catch(Exception e){reject(call,e);}
    }
    @PluginMethod public synchronized void resolve(PluginCall call){
        if(!trusted(call))return;try{String id=call.getString("id");receipt(id);JSObject r=new JSObject();r.put("url",android.net.Uri.fromFile(file(id)).toString());call.resolve(r);}catch(Exception e){reject(call,e);}
    }
}
