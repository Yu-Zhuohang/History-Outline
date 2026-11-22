"""data/events.json 结构校验。

用法：
    python tools/verify_data.py

校验项：字段完整性、id 唯一性、年份排序、年份与 date 一致、
四段考点字数区间（60–150）、经纬度范围与小数位。

退出码：0 全部通过；1 存在问题（逐条打印）。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(ROOT, "data", "events.json")
HTML_PATH = os.path.join(ROOT, "index.html")

FIELDS = ["id", "year", "date", "title", "locationName", "lat", "lng", "mapNote", "keyPoints"]
PARTS = ["background", "content", "significance", "examTips"]
MIN_CHARS, MAX_CHARS = 60, 150
LAT_RANGE = (3.0, 54.0)
LNG_RANGE = (73.0, 136.0)


def main():
    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)

    problems = []
    print("事件数: %d" % len(data))

    for e in data:
        eid = e.get("id")
        for field in FIELDS:
            if field not in e:
                problems.append("%s: 缺字段 %s" % (eid, field))
        for part in PARTS:
            if part not in e.get("keyPoints", {}):
                problems.append("%s: keyPoints 缺 %s" % (eid, part))

    ids = [e["id"] for e in data]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append("id 重复: %s" % dup)

    years = [e["year"] for e in data]
    if years != sorted(years):
        problems.append("未按年份升序")

    for e in data:
        for part in PARTS:
            text = e["keyPoints"].get(part, "")
            if not (MIN_CHARS <= len(text) <= MAX_CHARS):
                problems.append("字数越界 %s.%s = %d" % (e["id"], part, len(text)))

    for e in data:
        lat, lng = e["lat"], e["lng"]
        if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
            problems.append("%s: 纬度异常 %s" % (e["id"], lat))
        if not (LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
            problems.append("%s: 经度异常 %s" % (e["id"], lng))
        for value in (lat, lng):
            if len(str(value).split(".")[-1]) > 4:
                problems.append("%s: 坐标小数超过 4 位 %s" % (e["id"], value))

    for e in data:
        match = re.match(r"(\d{4})", e["date"])
        if not match or int(match.group(1)) != e["year"]:
            problems.append("%s: year=%s 与 date=%s 不一致" % (e["id"], e["year"], e["date"]))

    if os.path.exists(HTML_PATH):
        with open(HTML_PATH, encoding="utf-8") as f:
            html = f.read()
        html_ids = set(re.findall(r'data-id="([^"]+)"', html))
        if html_ids:
            problems.append("index.html 仍存在静态 data-id 节点（应为动态渲染）: %s" % sorted(html_ids))

    print("年份范围: %d - %d" % (years[0], years[-1]))
    print(
        "字数区间: %d - %d"
        % (
            min(len(e["keyPoints"][p]) for e in data for p in PARTS),
            max(len(e["keyPoints"][p]) for e in data for p in PARTS),
        )
    )
    print()

    if problems:
        print("发现 %d 个问题：" % len(problems))
        for item in problems:
            print("  - %s" % item)
        return 1

    print("全部检查通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
