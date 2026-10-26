"""Generate the synthetic sample PDFs used by the demo (no real personal data)."""
import random
from datetime import date, timedelta
from pathlib import Path
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "public" / "samples"
OUT.mkdir(parents=True, exist_ok=True)
rnd = random.Random(42)

FIRST = ["Emma","Liam","Olivia","Noah","Ava","Elijah","Sophia","Lucas","Mia","Mason","Amelia","Ethan","Harper","Logan","Ella","James","Aria","Leo","Chloe","Henry","Zoe","Jack","Nora","Owen"]
LAST = ["Smith","Johnson","Brown","Garcia","Miller","Davis","Wilson","Moore","Taylor","Anderson","Thomas","Martin","Clark","Lewis","Walker","Hall","Young","King","Wright","Scott"]

def table_pdf(path, title, subtitle, headers, widths, aligns, rows, pagesize=A4, rows_per_page=32):
    w, h = pagesize
    c = canvas.Canvas(str(path), pagesize=pagesize)
    c.setTitle(title)
    pages = [rows[i:i+rows_per_page] for i in range(0, len(rows), rows_per_page)]
    for pno, chunk in enumerate(pages, 1):
        x0, y = 40, h - 50
        c.setFont("Helvetica-Bold", 15); c.drawString(x0, y, title)
        c.setFont("Helvetica", 9); c.drawString(x0, y - 16, subtitle)
        y -= 46
        c.setFont("Helvetica-Bold", 9)
        x = x0
        for head, wd, al in zip(headers, widths, aligns):
            if al == "r": c.drawRightString(x + wd - 6, y, head)
            else: c.drawString(x, y, head)
            x += wd
        c.line(x0, y - 4, x0 + sum(widths) - 6, y - 4)
        y -= 17
        c.setFont("Helvetica", 9)
        for row in chunk:
            x = x0
            for val, wd, al in zip(row, widths, aligns):
                if al == "r": c.drawRightString(x + wd - 6, y, str(val))
                else: c.drawString(x, y, str(val))
                x += wd
            y -= 15
        c.setFont("Helvetica", 8)
        c.drawString(x0, 28, "Synthetic demo data generated for the PDF to Excel Extractor.")
        c.drawRightString(w - 40, 28, f"Page {pno} of {len(pages)}")
        c.showPage()
    c.save()

# 1) Membership register, grouped by branch
branches = ["Downtown", "Riverside", "Northgate", "Harbor View", "Westfield"]
rows = []
start = date(2026, 1, 5)
for i in range(1, 97):
    rows.append([i, f"M-{10230 + i * 7}", f"{rnd.choice(FIRST)} {rnd.choice(LAST)}", rnd.choice(branches),
                 (start + timedelta(days=rnd.randint(0, 280))).strftime("%Y-%m-%d"),
                 rnd.choice(["Active", "Active", "Active", "Pending", "Inactive"])])
table_pdf(OUT / "membership-register.pdf", "Membership Register 2026", "New member registrations by branch",
          ["No", "Member ID", "Full Name", "Branch", "Joined", "Status"],
          [36, 80, 150, 100, 80, 70], ["r", "l", "l", "l", "l", "l"], rows)

# 2) Store orders with amounts, grouped by store (landscape)
stores = ["Berlin", "Dubai Mall", "London Soho", "New York 5th Ave", "Singapore"]
products = ["Wireless Earbuds", "Smart Watch", "USB-C Hub", "Laptop Stand", "4K Monitor", "Mechanical Keyboard"]
price = {"Wireless Earbuds": 79.0, "Smart Watch": 199.0, "USB-C Hub": 39.5, "Laptop Stand": 45.0, "4K Monitor": 329.0, "Mechanical Keyboard": 119.0}
rows = []
d0 = date(2026, 7, 1)
for i in range(1, 121):
    p = rnd.choice(products); q = rnd.randint(1, 6)
    rows.append([f"#{48100 + i}", (d0 + timedelta(days=rnd.randint(0, 91))).strftime("%d/%m/%Y"), rnd.choice(stores), p, q,
                 f"{price[p]:,.2f}", f"{price[p] * q:,.2f}"])
table_pdf(OUT / "store-orders-q3.pdf", "Q3 2026 Store Orders", "All in-store orders, July to September (USD)",
          ["Order", "Date", "Store", "Product", "Qty", "Unit Price", "Total"],
          [70, 80, 130, 170, 50, 90, 90], ["l", "l", "l", "l", "r", "r", "r"], rows, pagesize=landscape(A4), rows_per_page=26)
print("ok", sorted(p.name for p in OUT.iterdir()))
