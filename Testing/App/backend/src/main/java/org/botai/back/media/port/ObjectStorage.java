package org.botai.back.media.port;

public interface ObjectStorage {
    void put(String key, byte[] bytes, String mimeType);
    byte[] get(String key, long maxBytes);
    void delete(String key);
    String bucket();
}
