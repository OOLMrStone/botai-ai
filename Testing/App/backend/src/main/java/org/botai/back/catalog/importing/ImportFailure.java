package org.botai.back.catalog.importing;

public class ImportFailure extends RuntimeException {
    public ImportFailure(String code) { super(code); }
}
