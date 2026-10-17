package com.streamguard.mobile;

import android.media.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.*;

/** Join completed MP4 segments without re-encoding. Missing audio preserves muted time gaps. */
final class SegmentMuxer {
    record Part(File file, long start, long end) {}
    static void join(List<Part> parts, File output) throws IOException {
        MediaMuxer muxer = new MediaMuxer(output.getPath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        Map<String, Integer> tracks = new HashMap<>(); boolean started = false;
        try {
            for (Part part : parts) {
                MediaExtractor extractor = new MediaExtractor();
                try {
                    extractor.setDataSource(part.file().getPath());
                    for (int index = 0; index < extractor.getTrackCount(); index++) {
                        MediaFormat format = extractor.getTrackFormat(index); String mime = format.getString(MediaFormat.KEY_MIME);
                        if (mime != null && !tracks.containsKey(mime)) tracks.put(mime, muxer.addTrack(format));
                    }
                } finally {extractor.release();}
            }
            if (tracks.isEmpty()) throw new IOException("No encoded tracks");
            muxer.start(); started = true;
            ByteBuffer buffer = ByteBuffer.allocate(2 * 1024 * 1024); MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long offset = 0;
            for (Part part : parts) {
                MediaExtractor extractor = new MediaExtractor(); long maximum = 0;
                try {
                    extractor.setDataSource(part.file().getPath()); Map<Integer, Integer> mapping = new HashMap<>();
                    for (int index = 0; index < extractor.getTrackCount(); index++) {
                        String mime = extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME);
                        if (tracks.containsKey(mime)) {mapping.put(index, tracks.get(mime)); extractor.selectTrack(index);}
                    }
                    while (extractor.getSampleTrackIndex() >= 0) {
                        buffer.clear(); int size = extractor.readSampleData(buffer, 0); if (size < 0) break;
                        long time = extractor.getSampleTime(); maximum = Math.max(maximum, time + 50000);
                        info.set(0, size, offset + time, extractor.getSampleFlags());
                        muxer.writeSampleData(mapping.get(extractor.getSampleTrackIndex()), buffer, info); extractor.advance();
                    }
                } finally {extractor.release();}
                offset += maximum;
            }
        } finally {
            try {if (started) muxer.stop();} finally {muxer.release();}
        }
    }
}
