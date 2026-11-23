"""UTF-8 local Kokoro bridge; C ABI matches sherpa-onnx 2.0.1 (Apache-2.0).
No network imports, microphone access, or external text transport.
ABI: https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/sherpa-onnx/c-api/c-api.h
"""
import ctypes as c
import json
import os
from pathlib import Path
import sys
import wave
from array import array

def struct(name, fields):
    return type(name, (c.Structure,), {'_fields_': fields})
def strings(names):
    return [(n, c.c_char_p) for n in names.split()]
def floats(names):
    return [(n, c.c_float) for n in names.split()]
Vits = struct('Vits', strings('model lexicon tokens data_dir') + floats('noise_scale noise_scale_w length_scale') + strings('dict_dir'))
Matcha = struct('Matcha', strings('acoustic_model vocoder lexicon tokens data_dir') + floats('noise_scale length_scale') + strings('dict_dir'))
Kokoro = struct('Kokoro', strings('model voices tokens data_dir') + floats('length_scale') + strings('dict_dir lexicon lang'))
Kitten = struct('Kitten', strings('model voices tokens data_dir') + floats('length_scale') + strings('lexicon'))
Zipvoice = struct('Zipvoice', strings('tokens encoder decoder vocoder data_dir lexicon') + floats('feat_scale t_shift target_rms guidance_scale'))
Pocket = struct('Pocket', strings('lm_flow lm_main encoder decoder text_conditioner vocab_json token_scores_json') + [('voice_embedding_cache_capacity', c.c_int32)])
Supertonic = struct('Supertonic', strings('duration_predictor text_encoder vector_estimator vocoder tts_json unicode_indexer voice_style'))
Model = struct('Model', [('vits', Vits), ('num_threads', c.c_int32), ('debug', c.c_int32), ('provider', c.c_char_p), ('matcha', Matcha), ('kokoro', Kokoro), ('kitten', Kitten), ('zipvoice', Zipvoice), ('pocket', Pocket), ('supertonic', Supertonic)])
Config = struct('Config', [('model', Model), ('rule_fsts', c.c_char_p), ('max_num_sentences', c.c_int32), ('rule_fars', c.c_char_p), ('silence_scale', c.c_float)])
Audio = struct('Audio', [('samples', c.POINTER(c.c_float)), ('n', c.c_int32), ('sample_rate', c.c_int32)])

runtime, model, request, output = map(Path, sys.argv[1:5])
libdir = runtime / 'lib'
if os.name == 'nt':
    dll_directory = os.add_dll_directory(str(libdir.resolve()))
lib = c.CDLL(str(libdir / ('sherpa-onnx-c-api.dll' if os.name == 'nt' else 'libsherpa-onnx-c-api.dylib')))
create = lib.SherpaOnnxCreateOfflineTts
create.argtypes, create.restype = [c.POINTER(Config)], c.c_void_p
generate = lib.SherpaOnnxOfflineTtsGenerate
generate.argtypes, generate.restype = [c.c_void_p, c.c_char_p, c.c_int32, c.c_float], c.POINTER(Audio)
lib.SherpaOnnxDestroyOfflineTts.argtypes = [c.c_void_p]
lib.SherpaOnnxDestroyOfflineTtsGeneratedAudio.argtypes = [c.POINTER(Audio)]
data = json.loads(request.read_text(encoding='utf-8'))
text = data['text']
if not isinstance(text, str) or not text.strip() or len(text) > 300:
    raise ValueError('Invalid speech text')
path = lambda name: str(model / name).encode('utf-8')
config = Config()
config.model.num_threads, config.model.provider = 2, b'cpu'
config.model.kokoro = Kokoro(path('model.int8.onnx'), path('voices.bin'), path('tokens.txt'), None, 1.0, None, path('lexicon-zh.txt') + b',' + path('lexicon-us-en.txt'), None)
config.rule_fsts = b','.join(path(n) for n in ['date-zh.fst', 'number-zh.fst', 'phone-zh.fst'])
config.max_num_sentences, config.silence_scale = 1, 1.0
tts = create(c.byref(config))
if not tts:
    raise RuntimeError('Unable to load local speech model')
audio = None
try:
    sid = int(data.get('sid', 45 if any('\u3400' <= ch <= '\u9fff' for ch in text) else 3))
    if sid not in [3, 45, 46, 47, 48, 49, 50, 51, 52]:
        raise ValueError('Invalid speaker')
    audio = generate(tts, text.encode('utf-8'), sid, 1.0)
    if not audio or not 0 < audio.contents.n <= 24000 * 180:
        raise RuntimeError('No valid speech output')
    value = audio.contents
    pcm = array('h', (round(max(-1.0, min(1.0, value.samples[i])) * 32767) for i in range(value.n)))
    if sys.byteorder != 'little':
        pcm.byteswap()
    with wave.open(str(output), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(value.sample_rate)
        f.writeframes(pcm.tobytes())
    print(json.dumps({'sampleRate': value.sample_rate, 'duration': value.n / value.sample_rate}))
finally:
    if audio:
        lib.SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio)
    lib.SherpaOnnxDestroyOfflineTts(tts)
