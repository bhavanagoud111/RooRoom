"""Scrapes UMKC's public course catalog (every subject, graduate and undergraduate) and the
public guest class schedule for one term (every subject), so RooRoom can offer every UMKC course
and let students pick the professor who is actually teaching it.

Sources (both public, no login):
  - https://catalog.umkc.edu/course-offerings/   (robots.txt allows /course-offerings/)
  - UMKC "Community Access" guest Class Search (PeopleSoft), linked from the Registrar's
    Schedule of Classes page. Instructor names are published there under Missouri SB 389.

Only course facts and instructor names are collected: no emails, phone numbers or student data.
Polite: one request at a time with a delay, identifies itself, caches pages so a rerun resumes.

    python3 scripts/scrape_umkc.py --term 5443          # 5443 = 2026 Fall Semester
Writes data/umkc/catalog.json and data/umkc/schedule_<term>.json.
Uses only the Python standard library (works with the macOS system python3).
"""
import argparse
import hashlib
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "umkc")
CACHE = os.path.join(OUT, "cache")
UA = "Mozilla/5.0 (compatible; RooRoom-student-hackathon-catalog-import/1.0)"
CATALOG = "https://catalog.umkc.edu"
PS_URL = "https://access.umkc.umsystem.edu/psc/prdpa/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL"
DELAY = 1.0


def text(fragment):
    fragment = re.sub(r"<br\s*/?>", "\n", fragment)
    return re.sub(r"[ \t\r\f\v]+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- catalog
def get_cached(url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + ".html")
    if os.path.exists(path):
        return open(path, encoding="utf-8").read()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            body = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
            break
        except Exception as e:  # network hiccup: back off and retry
            log(f"  retry {url}: {e}")
            time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError(f"could not fetch {url}")
    open(path, "w", encoding="utf-8").write(body)
    time.sleep(DELAY)
    return body


def scrape_catalog():
    index = get_cached(f"{CATALOG}/course-offerings/")
    pages = sorted(set(re.findall(r'href="(/course-offerings/(?:graduate|undergraduate)/[a-z0-9\-]+/)"', index)))
    log(f"catalog: {len(pages)} subject pages")
    courses = {}
    for n, page in enumerate(pages, 1):
        level = "graduate" if "/graduate/" in page else "undergraduate"
        s = get_cached(CATALOG + page)
        heading = re.search(r'<title>(.*?)\|', s, re.S)
        # "Computer Science (COMP-SCI) | University of ..." -> "Computer Science"
        subject_name = re.sub(r"\s*\([^)]*\)\s*$", "", text(heading.group(1))) if heading else ""
        blocks = re.findall(r'<div class="courseblock">(.*?)</div>', s, re.S)
        for b in blocks:
            code_m = re.search(r'<span class="code">(.*?)</span>', b, re.S)
            title_m = re.search(r'<span class="title">(.*?)</span>', b, re.S)
            if not code_m or not title_m:
                continue
            code = re.sub(r"\s+", " ", text(code_m.group(1)).replace("\xa0", " "))
            m = re.match(r"^([A-Z&\- ]+?)\s+(\d+[A-Z]*)$", code)
            if not m:
                continue
            hours = re.search(r'<span class="hours">(.*?)</span>', b, re.S)
            desc = re.search(r'<p class="courseblockdesc">(.*?)</p>', b, re.S)
            pre = re.search(r'<p class="prereqs">(.*?)</p>', b, re.S)
            courses[code] = {
                "code": code,
                "subject": m.group(1).strip(),
                "number": m.group(2),
                "title": text(title_m.group(1)),
                "credits": text(hours.group(1)).replace("Credits:", "").strip() if hours else None,
                "description": text(desc.group(1)) if desc else None,
                "prerequisites": text(pre.group(1)).replace("Prerequisites:", "").strip() if pre else None,
                "level": level,
                "subject_name": subject_name,
            }
        log(f"  [{n}/{len(pages)}] {page} {len(blocks)} courses")
    return sorted(courses.values(), key=lambda c: (c["subject"], c["number"]))


# ---------------------------------------------------------------- class schedule (PeopleSoft guest search)
class ClassSearch:
    def __init__(self, term):
        self.term = term
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.op.addheaders = [("User-Agent", UA)]

    def _open(self, data=None, query=""):
        for attempt in range(3):
            try:
                body = self.op.open(PS_URL + query, data, timeout=240).read().decode("utf-8", "replace")
                time.sleep(DELAY)
                return body
            except Exception as e:
                log(f"  retry class search: {e}")
                time.sleep(5 * (attempt + 1))
        raise RuntimeError("class search unreachable")

    @staticmethod
    def _state(s):
        return dict(re.findall(r"name='(IC[A-Za-z]+)' id='[^']*' value='([^']*)'", s))

    def _post(self, s, action, extra):
        d = self._state(s)
        d["ICAction"] = action
        d.update(extra)
        return self._open(urllib.parse.urlencode(d).encode())

    def start(self):
        s = self._open(query="?&AITS_HDR_CODE=2")
        s2 = self._post(s, "CLASS_SRCH_WRK2_STRM$35$", {"CLASS_SRCH_WRK2_STRM$35$": self.term})
        return s2 if self._state(s2).get("ICStateNum") else s

    def subjects(self):
        s = self.start()
        sel = re.search(r"<select name='SSR_CLSRCH_WRK_SUBJECT_SRCH\$0'.*?</select>", s, re.S)
        return [(v, html.unescape(n)) for v, n in re.findall(r'<option value="([^"]+)"[^>]*>([^<]*)', sel.group(0)) if v]

    def search(self, subject, career=""):
        s = self.start()
        s = self._post(s, "CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH", {
            "CLASS_SRCH_WRK2_STRM$35$": self.term,
            "SSR_CLSRCH_WRK_SUBJECT_SRCH$0": subject,
            "SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1": "G",
            "SSR_CLSRCH_WRK_CATALOG_NBR$1": "0",
            "SSR_CLSRCH_WRK_ACAD_CAREER$2": career,
            "SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk$3": "N",
        })
        if "would you like to continue" in s:
            s = self._post(s, "#ICSave", {})
        if re.search(r"maximum (limit|of \d+)", s, re.I):
            return None  # too many results: caller splits by career
        return self.parse(s)

    @staticmethod
    def parse(s):
        """Walks the page in order: each course title is followed by its sections."""
        rows = []
        events = []
        for m in re.finditer(r"id='win0divSSR_CLSRSLT_WRK_GROUPBOX2GP\$(\d+)'[^>]*>(.*?)</div>", s, re.S):
            events.append((m.start(), "course", text(m.group(2))))
        for m in re.finditer(r"id='MTG_CLASS_NBR\$(\d+)'", s):
            events.append((m.start(), "section", int(m.group(1))))
        events.sort()
        course = None
        for _, kind, val in events:
            if kind == "course":
                cm = re.match(r"^\s*([A-Z&\- ]+?)\s+(\d+[A-Z]*)\s+-\s+(.*)$", val.replace("\xa0", " "))
                course = {"subject": cm.group(1).strip(), "number": cm.group(2), "title": cm.group(3).strip()} if cm else None
                continue
            if not course:
                continue
            i = val

            def field(fid):
                m = re.search(r"id='%s\$%d'[^>]*>(.*?)</(?:span|a)>" % (re.escape(fid), i), s, re.S)
                return text(m.group(1)) if m else ""

            instr_m = re.search(r"id='win0divUM_SB389\$%d'[^>]*>(.*?)</div>" % i, s, re.S)
            names = []
            if instr_m:
                inner = re.search(r"<a [^>]*>(.*?)</a>", instr_m.group(1), re.S)
                raw = inner.group(1) if inner else instr_m.group(1)
                names = [n.strip() for n in text(raw).split("\n") if n.strip()]
            names = [n for n in names if n.lower() not in ("staff", "tba", "to be announced") and not re.match(r"\d\d/\d\d/\d{4}", n)]
            classname = field("MTG_CLASSNAME")  # e.g. "0002-LEC Regular"
            sm = re.match(r"^(\S+?)-(\w+)", classname)
            rows.append({
                "code": f"{course['subject']} {course['number']}",
                "subject": course["subject"],
                "number": course["number"],
                "title": course["title"],
                "class_nbr": field("MTG_CLASS_NBR"),
                "section": sm.group(1) if sm else classname,
                "component": sm.group(2) if sm else "",
                "days_times": field("MTG_DAYTIME"),
                "dates": field("MTG_TOPIC"),
                "instructors": names,
            })
        return rows


def scrape_schedule(term):
    """One subject at a time, each saved as it finishes, so a rerun resumes where it stopped."""
    cs = ClassSearch(term)
    subjects = cs.subjects()
    log(f"schedule {term}: {len(subjects)} subjects")
    part_dir = os.path.join(CACHE, f"schedule_{term}")
    os.makedirs(part_dir, exist_ok=True)
    out, failed = [], []
    for n, (code, name) in enumerate(subjects, 1):
        part = os.path.join(part_dir, re.sub(r"[^A-Za-z0-9_-]", "_", code) + ".json")
        if os.path.exists(part):
            rows = json.load(open(part))
            out.extend(rows)
            continue
        rows = None
        try:
            rows = cs.search(code)
        except RuntimeError as e:
            log(f"  {code}: whole-subject search failed ({e}); trying by level")
        if rows is None:  # too large or too slow: split by career
            rows, ok = [], True
            for career in ("UGRD", "GRAD", "LAW", "MEDS", "DENT", "PHAR"):
                try:
                    rows.extend(cs.search(code, career) or [])
                except RuntimeError as e:
                    log(f"  {code} {career}: failed ({e})")
                    ok = False
            if not ok:
                failed.append(code)
                out.extend(rows)
                log(f"  [{n}/{len(subjects)}] {code}: {len(rows)} sections (INCOMPLETE)")
                continue
        json.dump(rows, open(part, "w"), ensure_ascii=False)
        out.extend(rows)
        log(f"  [{n}/{len(subjects)}] {code}: {len(rows)} sections")
    if failed:
        log(f"INCOMPLETE subjects (rerun to retry): {', '.join(failed)}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--term", default="5443", help="PeopleSoft term code (5443 = 2026 Fall)")
    ap.add_argument("--skip-catalog", action="store_true")
    ap.add_argument("--skip-schedule", action="store_true")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if not a.skip_catalog:
        cat = scrape_catalog()
        json.dump(cat, open(os.path.join(OUT, "catalog.json"), "w"), indent=1, ensure_ascii=False)
        log(f"catalog.json: {len(cat)} courses")
    if not a.skip_schedule:
        sched = scrape_schedule(a.term)
        json.dump(sched, open(os.path.join(OUT, f"schedule_{a.term}.json"), "w"), indent=1, ensure_ascii=False)
        log(f"schedule_{a.term}.json: {len(sched)} sections")


if __name__ == "__main__":
    main()
