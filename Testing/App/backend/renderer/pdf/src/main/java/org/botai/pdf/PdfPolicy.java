package org.botai.pdf;

import org.apache.pdfbox.cos.*;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import java.io.IOException;
import java.util.*;
import static org.botai.pdf.PdfFailure.require;

final class PdfPolicy {
    private static final Set<String> ACTIVE_KEYS = Set.of("JS", "JavaScript", "AA", "OpenAction", "EmbeddedFiles", "EF", "AF", "XFA", "RichMediaContent", "RichMediaSettings", "3DD");
    private static final Set<String> ACTIONS = Set.of("JavaScript", "Launch", "URI", "SubmitForm", "ResetForm", "ImportData", "GoTo", "GoToR", "GoToE", "GoTo3DView", "Thread", "Named", "SetOCGState", "Rendition", "Sound", "Movie", "Trans", "Hide");
    private static final Set<String> ACTIVE_ANNOTATIONS = Set.of("RichMedia", "3D", "FileAttachment", "Sound", "Movie", "Screen");

    static int validate(PDDocument document, int budget) throws IOException {
        require(!document.isEncrypted(), "pdf_encrypted");
        require(document.getDocument().getXrefTable().size() <= 50000, "pdf_invalid");
        Set<COSBase> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        List<COSStream> streams = new ArrayList<>();
        var queue = new ArrayDeque<COSBase>();
        queue.add(document.getDocument().getTrailer());
        for (var key : document.getDocument().getXrefTable().keySet()) {
            var object = document.getDocument().getObjectFromPool(key).getObject();
            if (object != null) queue.add(object);
        }
        while (!queue.isEmpty()) {
            var object = queue.removeFirst(); if (!seen.add(object)) continue;
            require(seen.size() <= 200000, "pdf_invalid");
            if (object instanceof COSObject reference) { if (reference.getObject() != null) queue.add(reference.getObject()); }
            else if (object instanceof COSArray array) { require(array.size() <= 50000, "pdf_invalid"); for (var child : array) if (child != null) queue.add(child); }
            else if (object instanceof COSDictionary dictionary) {
                for (String name : ACTIVE_KEYS) require(!dictionary.containsKey(COSName.getPDFName(name)), "pdf_active_content");
                require(!"Action".equals(dictionary.getNameAsString(COSName.TYPE)) && !(dictionary.getNameAsString(COSName.S) != null && ACTIONS.contains(dictionary.getNameAsString(COSName.S))), "pdf_active_content");
                require(!(dictionary.getNameAsString(COSName.SUBTYPE) != null && ACTIVE_ANNOTATIONS.contains(dictionary.getNameAsString(COSName.SUBTYPE))), "pdf_active_content");
                if (dictionary instanceof COSStream stream) {
                    require(!dictionary.containsKey(COSName.F), "pdf_active_content");
                    streams.add(stream);
                }
                if ("Image".equals(dictionary.getNameAsString(COSName.SUBTYPE))) {
                    double width = numeric(dictionary.getDictionaryObject(COSName.WIDTH)), height = numeric(dictionary.getDictionaryObject(COSName.HEIGHT));
                    require(width >= 1 && height >= 1 && width <= 16384 && height <= 16384 && width * height <= 32000000, "pdf_geometry");
                }
                for (var entry : dictionary.entrySet()) if (entry.getValue() != null) queue.add(entry.getValue());
            }
        }
        COSBase root = document.getDocumentCatalog().getCOSObject().getDictionaryObject(COSName.PAGES);
        require(root instanceof COSDictionary, "pdf_invalid");
        int count = tree((COSDictionary)root, null, Collections.newSetFromMap(new IdentityHashMap<>()), 0, budget);
        require(count >= 1 && count <= budget, "pdf_page_budget");
        for (int index = 0; index < count; index++) geometry(document.getPage(index));
        // Decoders themselves remain inside the heap/tmpfs/deadline sandbox.
        // Bound decoded bytes admitted to rendering, including compressed content bombs.
        long total = 0;
        byte[] buffer = new byte[16384];
        for (COSStream stream : streams) {
            long bytes = 0;
            try (var input = stream.createInputStream()) {
                int length;
                while ((length = input.read(buffer)) != -1) {
                    bytes += length; total += length;
                    require(bytes <= 32L * 1024 * 1024 && total <= 96L * 1024 * 1024, "pdf_invalid");
                }
            }
        }
        return count;
    }

    private static int tree(COSDictionary node, COSDictionary parent, Set<COSDictionary> seen, int depth, int budget) {
        require(depth <= 32 && seen.size() < 256 && seen.add(node), "pdf_invalid");
        if (parent != null) require(node.getDictionaryObject(COSName.PARENT) == parent, "pdf_invalid");
        else require(!node.containsKey(COSName.PARENT), "pdf_invalid");
        String type = node.getNameAsString(COSName.TYPE);
        if ("Page".equals(type)) return 1;
        require("Pages".equals(type), "pdf_invalid");
        double declared = numeric(node.getDictionaryObject(COSName.COUNT));
        require(declared >= 1 && declared <= budget && declared == Math.floor(declared), "pdf_page_budget");
        var children = node.getDictionaryObject(COSName.KIDS); require(children instanceof COSArray, "pdf_invalid");
        var array = (COSArray)children; require(array.size() >= 1 && array.size() <= 256, "pdf_invalid");
        int count = 0;
        for (int index = 0; index < array.size(); index++) {
            var child = array.getObject(index); require(child instanceof COSDictionary, "pdf_invalid");
            count += tree((COSDictionary)child, node, seen, depth + 1, budget);
            require(count <= budget, "pdf_page_budget");
        }
        require(count == declared, "pdf_invalid"); return count;
    }

    static float scale(PDPage page) {
        geometry(page); var box = page.getCropBox();
        double width = box.getWidth(), height = box.getHeight();
        double scale = 200d / 72d * page.getUserUnit();
        scale = Math.min(scale, Math.min(4096d / width, 4096d / height));
        scale = Math.min(scale, Math.sqrt(6000000d / (width * height)));
        require(Double.isFinite(scale) && scale > 0, "pdf_geometry");
        return Math.nextDown((float)scale);
    }
    private static void geometry(PDPage page) {
        var unitValue = page.getCOSObject().getDictionaryObject(COSName.USER_UNIT);
        double unit = unitValue == null ? 1 : numeric(unitValue);
        require(unit > 0 && unit <= 75000, "pdf_geometry");
        var rawMedia = PDPageTree.getInheritableAttribute(page.getCOSObject(), COSName.MEDIA_BOX);
        var rawCrop = PDPageTree.getInheritableAttribute(page.getCOSObject(), COSName.CROP_BOX);
        require(rawMedia instanceof COSArray, "pdf_geometry");
        require(rawCrop == null || rawCrop instanceof COSArray, "pdf_geometry");
        rawRectangle((COSArray)rawMedia, unit);
        if (rawCrop != null) rawRectangle((COSArray)rawCrop, unit);
        var media = new PDRectangle((COSArray)rawMedia);
        var crop = rawCrop == null ? media : new PDRectangle((COSArray)rawCrop);
        rectangle(media, unit); rectangle(crop, unit);
        require(crop.getLowerLeftX() >= media.getLowerLeftX() && crop.getLowerLeftY() >= media.getLowerLeftY()
            && crop.getUpperRightX() <= media.getUpperRightX() && crop.getUpperRightY() <= media.getUpperRightY(), "pdf_geometry");
        var rotation = PDPageTree.getInheritableAttribute(page.getCOSObject(), COSName.ROTATE);
        if (rotation != null) { double angle = numeric(rotation); require(angle == Math.floor(angle) && angle % 90 == 0 && Math.abs(angle) <= 360, "pdf_geometry"); }
    }
    private static void rawRectangle(COSArray box, double unit) {
        require(box.size() == 4, "pdf_geometry");
        double[] values = new double[4];
        for (int index = 0; index < 4; index++) {
            values[index] = numeric(box.getObject(index));
            require(Math.abs(values[index]) <= 14400, "pdf_geometry");
        }
        require(values[2] > values[0] && values[3] > values[1]
            && (values[2] - values[0]) * unit <= 14400 && (values[3] - values[1]) * unit <= 14400, "pdf_geometry");
    }
    private static void rectangle(PDRectangle box, double unit) {
        var coordinates = box.getCOSArray(); require(coordinates.size() == 4, "pdf_geometry");
        for (int index = 0; index < 4; index++) require(Math.abs(numeric(coordinates.getObject(index))) <= 14400, "pdf_geometry");
        require(box.getWidth() > 0 && box.getHeight() > 0 && box.getWidth() * unit <= 14400 && box.getHeight() * unit <= 14400, "pdf_geometry");
    }
    private static double numeric(COSBase value) {
        require(value instanceof COSNumber, "pdf_geometry"); double number = ((COSNumber)value).floatValue();
        require(Double.isFinite(number), "pdf_geometry"); return number;
    }
}
