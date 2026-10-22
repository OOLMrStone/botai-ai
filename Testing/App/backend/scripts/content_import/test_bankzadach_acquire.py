import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from bankzadach_acquire import payload, validate, image_urls, Stop, canonical, BUCKET, Acquisition, SEED

class BankZadachTests(unittest.TestCase):
    def test_flight_long_utf8_text_and_element_references(self):
        long='строка\nещё строка'
        data={'catalogParts':[{'topics':['$2:props:parentTopic']}], 'tasks':[{'id':'x'}], 'totalTasks':1}
        records='1:T'+format(len(long.encode()),'x')+','+long+'2:'+json.dumps(['$','element',None,{'parentTopic':{'number':7},'children':data}])+'\n'
        raw=('<script>self.__next_f.push('+json.dumps([1,records])+')</script>').encode()
        out=payload(raw)
        self.assertEqual(out['catalogParts'][0]['topics'][0]['number'],7)
    def test_exact_read_only_routes(self):
        uid='11111111-2222-3333-4444-555555555555'
        for url in ['https://bank-zadach.ru/tasks/'+uid,'https://prod.bank-zadach.ru/api/v1/tasks/'+uid,'https://prod.bank-zadach.ru/api/v1/task-images/'+uid+'/original.svg?v=abc']:
            validate(url)
        for url in ['http://bank-zadach.ru/tasks','https://bank-zadach.ru/admin/delete','https://bank-zadach.ru/tasks?token=x','https://bank-zadach.ru/tasks/../admin','https://bank-zadach.ru.evil.test/tasks','https://user:pass@bank-zadach.ru/tasks','https://prod.bank-zadach.ru/api/v1/tasks/'+uid+'?secret=x','https://s3.twcstorage.ru/other-bucket/file.svg']:
            with self.assertRaises(Stop):validate(url)
    def test_media_discovery_excludes_provenance_and_links(self):
        task={'content_latex':'Text <img src="/api/v1/task-images/a/original.svg?v=123">','solution_latex':'<a href="https://bank-zadach.ru/handbooks/a">theory</a><img src="https://s3.twcstorage.ru/b/a.svg?a=1&amp;b=2">','images':[{'image_url':'/api/v1/task-images/a/original.svg?v=123','thumbnail_url':'thumb.webp'}],'seo':{'src':'https://s3.twcstorage.ru/irrelevant'},'source_references':[{'url':'https://s3.twcstorage.ru/irrelevant'}]}
        self.assertEqual(image_urls(task),['/api/v1/task-images/a/original.svg?v=123','https://s3.twcstorage.ru/b/a.svg?a=1&b=2'])
        self.assertEqual(canonical('https://s3.twcstorage.ru/b/a.svg?signature=private'),'https://s3.twcstorage.ru/b/a.svg')
    def test_census_does_not_silently_truncate_at_fifty(self):
        uid=lambda n:f"00000000-0000-0000-0000-{n:012d}"
        sub={'id':SEED,'name':'topic','tasks_count':51}
        topic={'id':uid(900),'number':7,'name':'Equations','subtopics':[sub]}
        page={'catalogParts':[{'tasks_count':51,'topics':[topic]}], 'tasks':[{'id':uid(n)} for n in range(50)],'totalTasks':51}
        with tempfile.TemporaryDirectory() as tmp:
            acq=Acquisition(Path(tmp),None);calls=[]
            def fetch(url,path):
                calls.append(url)
                return json.dumps({'tasks':[{'id':uid(50)}]}).encode() if '/api/' in url else b'html'
            acq.cached_get=fetch
            with patch('bankzadach_acquire.payload',return_value=page):out=acq.census()
            self.assertEqual(len(out['tasks']),51)
            self.assertTrue(any('page=2&per_page=50' in u for u in calls))
if __name__=='__main__':unittest.main()
