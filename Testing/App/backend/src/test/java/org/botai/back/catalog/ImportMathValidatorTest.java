package org.botai.back.catalog;

import org.botai.back.catalog.importing.ImportMathValidator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.assertj.core.api.Assertions.*;

class ImportMathValidatorTest {
    @TempDir Path temporary;
    private ImportMathValidator fixture(int status) throws Exception {
        Path script=temporary.resolve("validator.sh"),counter=temporary.resolve("counter");
        Files.writeString(script,"while IFS= read -r value; do :; done\nprintf '1\\n' >> '"+counter+"'\nexit "+status+"\n");
        return new ImportMathValidator("/bin/sh",script.toString(),temporary.resolve("package.json").toString());
    }
    @Test void positiveResultsAreReusedOnlyForExactFormula() throws Exception {
        var validator=fixture(0);
        validator.validate("x^2");validator.validate("x^2");validator.validate("x^3");
        assertThat(Files.readAllLines(temporary.resolve("counter"))).hasSize(2);
    }
    @Test void displayAndInlineHaveSeparateValidationCache() throws Exception {
        var validator=fixture(0);validator.validate("x",true);validator.validate("x",false);validator.validate("x",true);
        assertThat(Files.readAllLines(temporary.resolve("counter"))).hasSize(2);
    }
    @Test void failedResultsAreNeverCached() throws Exception {
        var validator=fixture(1);
        assertThatThrownBy(()->validator.validate("bad")).hasMessage("invalid_math");
        assertThatThrownBy(()->validator.validate("bad")).hasMessage("invalid_math");
        assertThat(Files.readAllLines(temporary.resolve("counter"))).hasSize(2);
    }
    @Test void aRecordUsesOneProcessForUniqueModeAwareFormulas() throws Exception {
        var validator=fixture(0);
        validator.validateAll(java.util.List.of(new ImportMathValidator.Formula("x",false),new ImportMathValidator.Formula("y",true),new ImportMathValidator.Formula("x",false)));
        validator.validate("x");validator.validate("y",true);
        assertThat(Files.readAllLines(temporary.resolve("counter"))).hasSize(1);
    }
    @Test void boundedBatchChunksLargeRecords() throws Exception {
        var validator=fixture(0);
        var formulas=new java.util.ArrayList<ImportMathValidator.Formula>();
        for(int i=0;i<129;i++)formulas.add(new ImportMathValidator.Formula("x_"+i,false));
        validator.validateAll(formulas);
        assertThat(Files.readAllLines(temporary.resolve("counter"))).hasSize(2);
    }
    @Test void failingBatchDoesNotCacheAnyOfItsFormulas() throws Exception {
        var validator=fixture(1);
        assertThatThrownBy(()->validator.validateAll(java.util.List.of(new ImportMathValidator.Formula("good",false),new ImportMathValidator.Formula("bad",false)))).hasMessage("invalid_math");
        assertThatThrownBy(()->validator.validate("good")).hasMessage("invalid_math");
        assertThat(Files.readAllLines(temporary.resolve("counter"))).hasSize(2);
    }
}
