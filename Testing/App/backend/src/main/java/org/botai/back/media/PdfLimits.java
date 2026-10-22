package org.botai.back.media;

import java.security.MessageDigest;
import java.util.HexFormat;

public final class PdfLimits {
    public static final int INPUT_BYTES=8*1024*1024;
    public static final int PAGES=4;
    public static final int MANIFEST_BYTES=16*1024;
    public static final int PAGE_PIXELS=6_000_000;
    public static final int PAGE_SIDE=4096;
    private PdfLimits() { }
    public static String hash(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch(java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
