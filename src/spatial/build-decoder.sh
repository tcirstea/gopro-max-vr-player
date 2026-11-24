#!/usr/bin/env bash
# Activate Emscripten 4.0.21 first. Run against a disposable FFmpeg checkout.
set -euo pipefail
out=$(cd "$(dirname "$0")" && pwd)
cd "${1:?Pass the pinned FFmpeg source checkout}"
rev=3a0867c2bfda4a4d4309ca1a8cbdc6175e67f587 # FFmpeg n7.1.5
[[ $(git rev-parse HEAD) = "$rev" && -z $(git status --porcelain --untracked-files=no) ]]
args=(--disable-pthreads)
flags=()
core=decoder-core
if [[ ${MULTICORE:-0} = 1 ]]; then
  args=(--enable-pthreads)
  flags=(-pthread)
  core=decoder-mt
fi
emconfigure ./configure \
  --target-os=none --arch=wasm32 --enable-cross-compile \
  --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm="$(em-config LLVM_ROOT)/llvm-nm" \
  --disable-asm --disable-inline-asm --disable-autodetect --disable-doc \
  --disable-debug --disable-programs --disable-network "${args[@]}" \
  --disable-w32threads --disable-os2threads --disable-avdevice --disable-avfilter \
  --disable-swresample --disable-postproc --disable-everything \
  --enable-decoder=hevc --enable-parser=hevc --enable-demuxer=mov --enable-protocol=file \
  --extra-cflags="-O3 -msimd128 ${flags[*]}" --extra-ldflags="${flags[*]}"
make -j "${JOBS:-4}"
link_flags=()
if [[ ${MULTICORE:-0} = 1 ]]; then
  link_flags=(-pthread -sPTHREAD_POOL_SIZE=4 -sPTHREAD_POOL_SIZE_STRICT=2)
fi
emcc -O3 -msimd128 "${link_flags[@]}" -I. "$out/decoder.c" libavformat/libavformat.a libavcodec/libavcodec.a \
  libswscale/libswscale.a libavutil/libavutil.a -lworkerfs.js \
  -sENVIRONMENT=worker -sMODULARIZE=1 -sEXPORT_ES6=1 -sFORCE_FILESYSTEM=1 \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 \
  -sEXPORTED_FUNCTIONS=_sp_open,_sp_next,_sp_width,_sp_height,_sp_time,_sp_fps,_sp_eye,_sp_close,_sp_error \
  -sEXPORTED_RUNTIME_METHODS=FS,WORKERFS,UTF8ToString,HEAPU8 \
  -o "$out/$core.mjs"
gzip -9n -c "$out/$core.wasm" > "$out/$core.wasm.gz"
rm "$out/$core.wasm"
