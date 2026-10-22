package org.botai.pdf;

final class PdfFailure extends RuntimeException {
    final String code;
    PdfFailure(String code) { super(code); this.code = code; }
    static void require(boolean condition, String code) { if (!condition) throw new PdfFailure(code); }
}
