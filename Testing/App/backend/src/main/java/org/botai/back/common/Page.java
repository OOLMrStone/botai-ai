package org.botai.back.common;

import java.util.List;
public record Page<T>(List<T> items,String nextCursor) {
    public static int limit(Integer value) { if(value==null)return 20; if(value<1||value>50)throw ApiException.invalid("Размер страницы от 1 до 50");return value; }
    public static int offset(String cursor) {
        if(cursor==null||cursor.isBlank())return 0;
        try { int n=Integer.parseInt(cursor);if(n<0||n>100000)throw new NumberFormatException();return n; }
        catch(NumberFormatException e) { throw ApiException.invalid("Некорректный курсор"); }
    }
    public static <T> Page<T> of(List<T> rows,int offset,int limit) { return new Page<>(rows.stream().limit(limit).toList(),rows.size()>limit?Integer.toString(offset+limit):null); }
}
