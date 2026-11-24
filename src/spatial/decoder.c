/* Spatial decoder bridge, distributed under LGPL-2.1-or-later. */
#include <errno.h>
#include <stdint.h>
#include <stdatomic.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/opt.h>
#include <libavutil/stereo3d.h>
#include <libswscale/swscale.h>

static AVFormatContext *movie;
static AVCodecContext *codec;
static AVStream *stream;
static AVPacket *packet;
static AVFrame *frame;
static struct SwsContext *scaler;
static uint8_t *images[2];
static int width, height, pending, draining, mask, max_width, colorspace, range;
static _Atomic uint32_t eye_ids; /* packed left/right IDs, set by get_format on decoder threads */
static int64_t pts;
static double timestamp;
static char error[AV_ERROR_MAX_STRING_SIZE + 96];

static int fail(const char *step, int code) {
    char detail[AV_ERROR_MAX_STRING_SIZE];
    av_strerror(code, detail, sizeof(detail));
    snprintf(error, sizeof(error), "%s: %s", step, detail);
    return -1;
}
const char *sp_error(void) { return error; }
int sp_width(void) { return width; }
int sp_height(void) { return height; }
double sp_time(void) { return timestamp; }
double sp_fps(void) { return av_q2d(av_guess_frame_rate(movie, stream, NULL)); }
const uint8_t *sp_eye(int eye) { return eye == 0 || eye == 1 ? images[eye] : NULL; }

void sp_close(void) {
    avcodec_free_context(&codec);
    avformat_close_input(&movie);
    av_packet_free(&packet);
    av_frame_free(&frame);
    sws_freeContext(scaler); scaler = NULL;
    av_freep(&images[0]); av_freep(&images[1]);
    stream = NULL;
    width = height = pending = draining = mask = 0;
    colorspace = range = -1;
    atomic_store(&eye_ids, 0);
}

static enum AVPixelFormat pick_format(AVCodecContext *current, const enum AVPixelFormat *formats) {
    unsigned n, pn, ids[2], positions[2];
    if (av_opt_get_array_size(current, "view_ids_available", AV_OPT_SEARCH_CHILDREN, &n) < 0 || n != 2 ||
        av_opt_get_array_size(current, "view_pos_available", AV_OPT_SEARCH_CHILDREN, &pn) < 0 || pn != n ||
        av_opt_get_array(current, "view_ids_available", AV_OPT_SEARCH_CHILDREN, 0, n, AV_OPT_TYPE_UINT, ids) < 0 ||
        av_opt_get_array(current, "view_pos_available", AV_OPT_SEARCH_CHILDREN, 0, n, AV_OPT_TYPE_UINT, positions) < 0 ||
        ids[0] > 0xffff || ids[1] > 0xffff || ids[0] == ids[1])
        return AV_PIX_FMT_NONE;
    uint32_t map;
    if (positions[0] == AV_STEREO3D_VIEW_LEFT && positions[1] == AV_STEREO3D_VIEW_RIGHT)
        map = (ids[0] << 16) | ids[1];
    else if (positions[0] == AV_STEREO3D_VIEW_RIGHT && positions[1] == AV_STEREO3D_VIEW_LEFT)
        map = (ids[1] << 16) | ids[0];
    else return AV_PIX_FMT_NONE;
    uint32_t previous = 0;
    if (!atomic_compare_exchange_strong(&eye_ids, &previous, map) && previous != map)
        return AV_PIX_FMT_NONE;
    return avcodec_default_get_format(current, formats);
}

int sp_open(int target_width, int threads) {
    int ret;
    sp_close();
    max_width = target_width;
    if ((ret = avformat_open_input(&movie, "/input/local.mov", av_find_input_format("mov"), NULL)) < 0)
        return fail("Reading MOV", ret);
    for (unsigned i = 0; i < movie->nb_streams; ++i)
        if (movie->streams[i]->codecpar->codec_id == AV_CODEC_ID_HEVC) {
            stream = movie->streams[i]; break;
        }
    if (!stream) return fail("No HEVC video track", AVERROR_STREAM_NOT_FOUND);
    const AVCodec *hevc = avcodec_find_decoder(AV_CODEC_ID_HEVC);
    codec = avcodec_alloc_context3(hevc);
    packet = av_packet_alloc();
    frame = av_frame_alloc();
    if (!codec || !packet || !frame) return fail("Allocating decoder", AVERROR(ENOMEM));
    if ((ret = avcodec_parameters_to_context(codec, stream->codecpar)) < 0)
        return fail("Reading HEVC settings", ret);
    codec->pkt_timebase = stream->time_base;
    codec->get_format = pick_format;
    codec->thread_count = threads >= 1 && threads <= 4 ? threads : 1;
    codec->max_pixels = 4096LL * 4096;
    const int all = -1;
    if ((ret = av_opt_set_array(codec, "view_ids", AV_OPT_SEARCH_CHILDREN, 0, 1, AV_OPT_TYPE_INT, &all)) < 0 ||
        (ret = avcodec_open2(codec, hevc, NULL)) < 0)
        return fail("Opening MV-HEVC decoder", ret);
    return 0;
}

static int eye_for_frame(void) {
    const AVFrameSideData *sd = av_frame_get_side_data(frame, AV_FRAME_DATA_VIEW_ID);
    uint32_t map = atomic_load(&eye_ids);
    if (!map) return -1;
    int id = 0;
    if (sd && sd->size >= sizeof(id)) memcpy(&id, sd->data, sizeof(id));
    if ((unsigned)id == map >> 16) return 0;
    if ((unsigned)id == (map & 0xffff)) return 1;
    return -1;
}

static int copy_eye(void) {
    int eye = eye_for_frame();
    if (eye < 0) return fail("Two explicitly labeled stereo views are required", AVERROR_INVALIDDATA);
    int64_t t = frame->best_effort_timestamp;
    if (t == AV_NOPTS_VALUE) t = frame->pts;
    if (t == AV_NOPTS_VALUE || (mask && (t != pts || (mask & (1 << eye)))))
        return fail("Could not match left/right frame timestamps", AVERROR_INVALIDDATA);
    if (!width) {
        width = FFMIN(frame->width, max_width);
        height = FFMAX(1, (int)av_rescale(frame->height, width, frame->width));
        if (height > 2160) return fail("Unsupported tall frame", AVERROR_INVALIDDATA);
        for (int i = 0; i < 2; ++i) images[i] = av_mallocz((size_t)width * height * 4 + 64);
        if (!images[0] || !images[1]) return fail("Allocating both eyes", AVERROR(ENOMEM));
    }
    struct SwsContext *previous = scaler;
    scaler = sws_getCachedContext(scaler, frame->width, frame->height, frame->format,
                                  width, height, AV_PIX_FMT_RGBA, SWS_FAST_BILINEAR,
                                  NULL, NULL, NULL);
    if (!scaler) return fail("Scaling decoded frame", AVERROR(ENOMEM));
    int cs = frame->colorspace == AVCOL_SPC_BT470BG || frame->colorspace == AVCOL_SPC_SMPTE170M ?
             SWS_CS_ITU601 : frame->colorspace == AVCOL_SPC_BT2020_NCL ? SWS_CS_BT2020 : SWS_CS_ITU709;
    int full = frame->color_range == AVCOL_RANGE_JPEG;
    if (previous != scaler || colorspace != cs || range != full) {
        const int *coeffs = sws_getCoefficients(cs);
        sws_setColorspaceDetails(scaler, coeffs, full, coeffs, 1, 0, 1 << 16, 1 << 16);
        colorspace = cs; range = full;
    }
    uint8_t *dst[4] = {images[eye], NULL, NULL, NULL};
    int stride[4] = {width * 4, 0, 0, 0};
    if (sws_scale(scaler, (const uint8_t *const *)frame->data, frame->linesize, 0,
                  frame->height, dst, stride) != height)
        return fail("Converting eye pixels", AVERROR_INVALIDDATA);
    pts = t;
    mask |= 1 << eye;
    if (mask != 3) return 0;
    timestamp = pts * av_q2d(stream->time_base);
    mask = 0;
    return 1;
}

int sp_next(void) {
    for (;;) {
        int ret = avcodec_receive_frame(codec, frame);
        if (ret == AVERROR_EOF)
            return mask ? fail("Missing final stereo eye", AVERROR_INVALIDDATA) : 0;
        if (ret >= 0) {
            int result = copy_eye();
            av_frame_unref(frame);
            if (result) return result;
            continue;
        }
        if (ret != AVERROR(EAGAIN)) return fail(atomic_load(&eye_ids) ? "Decoding HEVC" : "No labeled MV-HEVC stereo views found", ret);
        if (draining) return fail("Incomplete end of stream", ret);
        if (!pending) {
            while ((ret = av_read_frame(movie, packet)) >= 0) {
                if (packet->stream_index == stream->index) { pending = 1; break; }
                av_packet_unref(packet);
            }
            if (!pending && ret != AVERROR_EOF) return fail("Reading video packets", ret);
        }
        ret = avcodec_send_packet(codec, pending ? packet : NULL);
        if (ret < 0) return fail("Submitting HEVC packet", ret);
        if (!pending) draining = 1;
        av_packet_unref(packet);
        pending = 0;
    }
}
