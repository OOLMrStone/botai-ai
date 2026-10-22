package org.botai.back.expert;

import org.botai.back.common.ApiException;
import org.botai.back.common.JsonCodec;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class ExpertSymbolicDiagramTest {
    private final JsonMapper json=JsonMapper.builder().build();
    private final JsonCodec codec=new JsonCodec(json);
    private final ExpertReviewDocument validator=new ExpertReviewDocument(codec);
    private final ExpertGradingBasis basis=new ExpertGradingBasis(codec);

    @Test void numberLineRetainsSparseSelfLoopsInfinitySignsUnknownExpressionsAndOriginalOrder() {
        var line=line();var doc=document(line);var before=tree(doc);
        accepted(doc);
        assertThat(tree(doc)).isEqualTo(before);
        assertThat(before.path("ocr").path("blocks").get(0).path("content").path("diagram")).isEqualTo(tree(line));
        line.put("points",List.of(point("z","\\operatorname{unknown}(x)",false,null),point("a","-\\pi/2",true,"0")));
        line.put("arcs",List.of(arc("a","a",null,false),arc("-inf","z","0",true),arc("z","+inf","-",false)));
        accepted(doc); // No inferred sorting, adjacency, filled intervals, numeric parsing or direction.
        line.put("points",List.of());line.put("arcs",List.of(arc("-inf","+inf",null,true)));accepted(doc);
    }

    @Test void symbolicTypesAreNestedV2OnlyAndLegacyNumericSchemasStayStrict() {
        for(var diagram:List.of(line(),circle())) {
            var doc=document(diagram);accepted(doc);
            doc.put("schema_version","expert-review.v1");rejected(doc);
            doc.put("schema_version","expert-review.v2");block(doc).put("content",diagram);rejected(doc);
            doc.put("schema_version","expert-review.v1");rejected(doc);
        }
        var legacy=map("type","number_line","axis_label","x","points",List.of(),"intervals",List.of(map("left_point_id",null,"right_point_id",null,"sign","unknown","selected",false)));
        var doc=document(legacy);accepted(doc);legacy.put("note",null);rejected(doc);
        var unknown=line();unknown.put("type","number_line_v3");rejected(document(unknown));
    }

    @Test void exactKeysAndRequiredNullsAreEnforcedAtEveryLevel() {
        for(String key:List.of("type","variable","note","points","arcs")){var line=line();line.remove(key);rejected(document(line));}
        for(String key:List.of("id","value","included","sign")){var p=point("p1","x",true,null);p.remove(key);var line=line();line.put("points",List.of(p));rejected(document(line));}
        for(String key:List.of("from","to","sign","selected")){var a=arc("p1","p1",null,true);a.remove(key);var line=line();line.put("arcs",List.of(a));rejected(document(line));}
        var line=line();line.put("kind","number_line");rejected(document(line));
        line=line();var p=point("p1","x",true,null);p.put("url","https://invalid");line.put("points",List.of(p));rejected(document(line));
        line=line();var a=arc("p1","p1",null,true);a.put("direction","ccw");line.put("arcs",List.of(a));rejected(document(line));
        var circle=circle();circle.put("note",null);rejected(document(circle));
    }

    @Test void nullableInclusionRequiresExplicitTrueBoundaryAndAllBooleansAndSignsAreTyped() {
        var line=line();var p=point("p1","x",null,null);line.put("points",List.of(p));rejected(document(line));
        p.put("bound",false);rejected(document(line));p.put("bound",true);accepted(document(line));
        for(Object bound:List.of("true",1)){p.put("bound",bound);rejected(document(line));}
        p.put("bound",null);rejected(document(line));p.put("bound",true);p.put("included","true");rejected(document(line));
        p.put("included",true);for(Object sign:List.of("unknown","undefined","",1)){p.put("sign",sign);rejected(document(line));}
        p.put("sign",null);var a=arc("p1","p1",null,true);line.put("arcs",List.of(a));accepted(document(line));
        a.put("sign","unknown");rejected(document(line));a.put("sign","0");a.put("selected",null);rejected(document(line));a.put("selected","true");rejected(document(line));
        a.put("selected",false);accepted(document(line));
    }

    @Test void idsEndpointsAndBoundsAreCheckedWithoutNormalizingContent() {
        for(String id:List.of(""," ","a".repeat(129),"-inf","+inf")){var line=line();line.put("points",List.of(point(id,"x",true,null)));rejected(document(line));}
        var line=line();line.put("points",List.of(point("p1","x",true,null),point("p1","y",false,null)));rejected(document(line));
        line=line();line.put("arcs",List.of(arc("missing","p1",null,true)));rejected(document(line));
        var circle=circle();circle.put("arcs",List.of(circleArc("-inf","p1",false)));rejected(document(circle));
        for(Object value:Arrays.asList(null,1," ","a".repeat(501))){line=line();line.put("points",List.of(point("p1",value,true,null)));rejected(document(line));}
        for(Object variable:Arrays.asList(null,1," ","x".repeat(65))){line=line();line.put("variable",variable);rejected(document(line));}
        for(Object note:List.of(1," ","n".repeat(2001))){line=line();line.put("note",note);rejected(document(line));}
        line=line();line.put("variable","x".repeat(64));line.put("note","n".repeat(2000));line.put("points",List.of(point("p".repeat(128),"x".repeat(500),true,"+")));line.put("arcs",List.of());accepted(document(line));
        var points=new ArrayList<Map<String,Object>>();for(int i=0;i<64;i++)points.add(point("p"+i,"x",true,null));line.put("points",points);line.put("arcs",Collections.nCopies(128,arc("p0","p0","0",false)));accepted(document(line));
        line.put("arcs",Collections.nCopies(129,arc("p0","p0",null,false)));rejected(document(line));line.put("arcs",List.of());points.add(point("p64","x",true,null));rejected(document(line));
    }

    @Test void circleRequiresExplicitDirectionAndConsistentFullCircleForEveryArc() {
        var circle=circle();var doc=document(circle);accepted(doc);
        for(String key:List.of("direction","full_circle")){var arc=circleArc("p1","p1",true);arc.remove(key);circle.put("arcs",List.of(arc));rejected(doc);}
        var arc=circleArc("p1","p1",false);circle.put("arcs",List.of(arc));rejected(doc);
        arc.put("full_circle",true);accepted(doc);arc.put("direction","cw");accepted(doc);
        for(Object direction:Arrays.asList(null,"unknown",1)){arc.put("direction",direction);rejected(doc);}
        arc.put("direction","ccw");arc.put("full_circle","true");rejected(doc);arc.put("full_circle",null);rejected(doc);
        circle.put("points",List.of(point("p1","\\pi/2",true,"+"),point("p2","unknown",false,"0")));
        arc=circleArc("p1","p2",true);circle.put("arcs",List.of(arc));rejected(doc);arc.put("full_circle",false);accepted(doc);
        arc.put("to","missing");rejected(doc);
    }

    @Test void semanticHashIncludesEverySymbolicFieldPresenceAndArrayOrder() {
        var line=line();var doc=document(line);String original=basis.hash(tree(doc));
        for(String key:List.of("variable","note")){line.put(key,"changed");assertThat(basis.hash(tree(doc))).isNotEqualTo(original);line=line();doc=document(line);}
        var p=point("p1","x",true,null);line.put("points",List.of(p));line.put("arcs",List.of(arc("p1","p1",null,true)));String start=basis.hash(tree(doc));
        for(String key:List.of("id","value","included","sign","bound")){var saved=new LinkedHashMap<>(p);p.put(key,key.equals("included")||key.equals("bound")?false:"changed");assertThat(basis.hash(tree(doc))).isNotEqualTo(start);p.clear();p.putAll(saved);}
        var arc=arc("p1","p1",null,true);line.put("arcs",List.of(arc));start=basis.hash(tree(doc));
        for(String key:List.of("from","to","sign","selected")){var saved=new LinkedHashMap<>(arc);arc.put(key,key.equals("selected")?false:"changed");assertThat(basis.hash(tree(doc))).isNotEqualTo(start);arc.clear();arc.putAll(saved);}
        var circle=circle();doc=document(circle);start=basis.hash(tree(doc));var cArc=circleArc("p1","p1",true);circle.put("arcs",List.of(cArc));cArc.put("direction","cw");assertThat(basis.hash(tree(doc))).isNotEqualTo(start);cArc.put("direction","ccw");cArc.put("full_circle",false);assertThat(basis.hash(tree(doc))).isNotEqualTo(start);
        var a=point("a","2",true,null);var b=point("b","1",false,null);line=line();line.put("points",List.of(a,b));line.put("arcs",List.of());doc=document(line);start=basis.hash(tree(doc));line.put("points",List.of(b,a));assertThat(basis.hash(tree(doc))).isNotEqualTo(start);
    }

    private Map<String,Object> line(){return map("type","number_line_v2","variable","x","note",null,"points",List.of(point("p1","\\sqrt{2}",true,null)),"arcs",List.of(arc("-inf","p1","+",false),arc("p1","p1","0",true),arc("p1","+inf",null,true)));}
    private Map<String,Object> circle(){return map("type","unit_circle_v2","points",List.of(point("p1","\\pi/2",true,null)),"arcs",List.of(circleArc("p1","p1",true)));}
    private static Map<String,Object> point(String id,Object value,Object included,Object sign){return map("id",id,"value",value,"included",included,"sign",sign);}
    private static Map<String,Object> arc(String from,String to,Object sign,Object selected){return map("from",from,"to",to,"sign",sign,"selected",selected);}
    private static Map<String,Object> circleArc(String from,String to,boolean full){var arc=arc(from,to,null,true);arc.put("direction","ccw");arc.put("full_circle",full);return arc;}
    private Map<String,Object> document(Map<String,Object> diagram){return map("schema_version","expert-review.v2","origin","expert","phase","analysis","solution_image_ids",List.of(),"ocr",map("blocks",List.of(map("id","b1","sources",List.of(),"content",map("type","step","lines",List.of(),"diagram",diagram)))),"analysis",map("block_reviews",List.of(map("block_id","b1","status",null,"explanation",null,"follows_from_block_ids",List.of())),"summary",null,"checks",null,"student_answer",null,"strengths",List.of(),"findings",List.of()),"grading",null,"rejection_reason",null);}
    @SuppressWarnings("unchecked") private static Map<String,Object> block(Map<String,Object> doc){return (Map<String,Object>)((List<?>)((Map<?,?>)doc.get("ocr")).get("blocks")).get(0);}
    private JsonNode tree(Object value){return json.readTree(json.writeValueAsString(value));}
    private void accepted(Map<String,Object> doc){validator.validate(tree(doc),List.of(),3,false);}
    private void rejected(Map<String,Object> doc){assertThatThrownBy(()->accepted(doc)).isInstanceOf(ApiException.class);}
    private static Map<String,Object> map(Object... entries){var map=new LinkedHashMap<String,Object>();for(int i=0;i<entries.length;i+=2)map.put((String)entries[i],entries[i+1]);return map;}
}
