from html import escape
from pathlib import Path


OUT = Path(__file__).parent
INK = "#17243A"

WORDMARKS = [
    ("holon", "Arial, Helvetica, sans-serif", 55, "bold", -3, "normal"),
    ("HOLON", "Arial, Helvetica, sans-serif", 47, "bold", 1, "normal"),
    ("holon", "Helvetica Neue, Arial, sans-serif", 56, "normal", -3, "normal"),
    ("holon", "Georgia, Times New Roman, serif", 55, "bold", -4, "normal"),
    ("holon", "Menlo, Monaco, monospace", 45, "bold", -4, "normal"),
    ("holon", "Georgia, Times New Roman, serif", 55, "normal", -3, "italic"),
]


def wordmark(index: int, x: int, y: int) -> str:
    label, font, size, weight, spacing, style = WORDMARKS[index - 1]
    return f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" font-style="{style}" letter-spacing="{spacing}" fill="{INK}">{label}</text>'


def symbol(index: int, mono: bool = False) -> str:
    primary = INK
    accent = INK if mono else {
        1: "#4177EF",
        2: "#F36D45",
        3: "#735BE8",
        4: "#CE7637",
        5: "#0C9A91",
        6: "#8864E7",
    }[index]
    if index == 1:
        return f'''<path d="M72 18A36 36 0 1 0 83 54" fill="none" stroke="{primary}" stroke-width="12" stroke-linecap="round"/>
<path d="M76 16l10 8" fill="none" stroke="{accent}" stroke-width="12" stroke-linecap="round"/>
<circle cx="50" cy="50" r="10" fill="{accent}"/>'''
    if index == 2:
        return f'''<path d="M18 18h18v25h28V18h18v64H64V57H36v25H18Z" fill="{primary}"/>
<path d="M36 43h28v14H36Z" fill="{accent}"/>
<circle cx="50" cy="50" r="4" fill="#FFFFFF"/>'''
    if index == 3:
        return f'''<path d="M70 14H29c-9 0-15 6-15 15v42c0 9 6 15 15 15h42c9 0 15-6 15-15V52" fill="none" stroke="{primary}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M43 64h17c3 0 5-2 5-5V41c0-3-2-5-5-5H41c-3 0-5 2-5 5v13" fill="none" stroke="{accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'''
    if index == 4:
        return f'''<text x="50" y="72" text-anchor="middle" font-family="Georgia, Times New Roman, serif" font-size="77" font-weight="bold" fill="{primary}">ὅ</text>
<path d="M19 85h62" stroke="{accent}" stroke-width="5" stroke-linecap="round"/>'''
    if index == 5:
        return f'''<path d="M18 76h22V51h22V27h16" fill="none" stroke="{primary}" stroke-width="11" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="18" cy="76" r="8" fill="{primary}"/>
<circle cx="78" cy="27" r="10" fill="#FFFFFF" stroke="{accent}" stroke-width="8"/>
<path d="M55 69l7 7 16-17" fill="none" stroke="{accent}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'''
    return f'''<path d="M17 69C11 39 37 17 80 18c5 35-12 64-43 65-10 0-17-5-20-14Z" fill="none" stroke="{primary}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M42 65c-5-15 7-30 24-29 3 16-10 31-24 29Z" fill="{accent}"/>'''


DIRECTIONS = [
    ("Órbita", "Parte dentro do todo", "O círculo permanece aberto: o ponto central tem identidade própria e pertence ao conjunto.", "Forma-símbolo"),
    ("Encaixe", "Monograma H", "Dois lados se unem por uma ponte. A leitura de H favorece reconhecimento imediato.", "App e avatar"),
    ("Molduras", "Contexto em camadas", "O recorte interno vive dentro do contexto maior, sem perder sua própria borda.", "Sistema visual"),
    ("ὅλον", "Raiz grega", "A origem do nome vira identidade. A palavra e o sinal tipográfico ocupam o centro.", "Marca editorial"),
    ("Rastro", "Revisão além do diff", "Um caminho parte da mudança e chega a uma conclusão verificada.", "Produto técnico"),
    ("Semente", "Todo vivo, parte viva", "Uma forma orgânica contém outra; a metáfora natural da planta e da semente.", "Marca orgânica"),
]

BOARD_COPY = [
    ("Um ponto com identidade própria", "participa de um conjunto aberto."),
    ("Duas partes formam um H legível.", "Funciona em avatar e favicon."),
    ("O recorte interno ganha contexto", "sem perder sua própria borda."),
    ("A raiz grega ocupa o centro.", "Uma marca editorial e autoral."),
    ("Um caminho liga mudança e", "conclusão verificada."),
    ("Uma forma viva contém outra.", "A planta e a semente em uma marca."),
]


def svg(inner: str, viewbox: str = "0 0 100 100", width: int | None = None, height: int | None = None) -> str:
    size = f' width="{width}" height="{height}"' if width and height else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}"{size}>\n{inner}\n</svg>\n'


for i, (name, _, _, _) in enumerate(DIRECTIONS, 1):
    slug = ["orbita", "encaixe", "molduras", "greek", "rastro", "semente"][i - 1]
    (OUT / f"{i:02d}-{slug}.svg").write_text(svg(symbol(i)), encoding="utf-8")
    (OUT / f"{i:02d}-{slug}-mono.svg").write_text(svg(symbol(i, True)), encoding="utf-8")
    (OUT / f"{i:02d}-{slug}-wordmark.svg").write_text(svg(wordmark(i, 0, 68), "0 0 300 100", 300, 100), encoding="utf-8")
    lockup = f'<svg x="0" y="0" width="100" height="100" viewBox="0 0 100 100">{symbol(i)}</svg>\n{wordmark(i, 122, 68)}'
    (OUT / f"{i:02d}-{slug}-lockup.svg").write_text(svg(lockup, "0 0 420 100", 420, 100), encoding="utf-8")


def board_card(i: int, x: int, y: int) -> str:
    name, concept, description, use = DIRECTIONS[i - 1]
    line_one, line_two = BOARD_COPY[i - 1]
    s = symbol(i)
    sm = symbol(i, True)
    return f'''<g transform="translate({x} {y})">
<rect width="530" height="430" rx="28" fill="#FFFFFF" stroke="#E4E7E9" stroke-width="1"/>
<text x="30" y="46" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="bold" fill="#89919B">{i:02d} / 06</text>
<text x="500" y="46" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#89919B">{escape(use)}</text>
<rect x="30" y="78" width="156" height="156" rx="28" fill="#F2F4F5"/>
<svg x="51" y="99" width="114" height="114" viewBox="0 0 100 100">{s}</svg>
{wordmark(i, 212, 154)}
<text x="32" y="286" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="bold" fill="{INK}">{escape(name)}</text>
<text x="32" y="316" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#5A6777">{escape(concept)}</text>
<text x="32" y="351" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#5A6777">{escape(line_one)}</text>
<text x="32" y="374" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#5A6777">{escape(line_two)}</text>
<rect x="448" y="270" width="52" height="52" rx="13" fill="{INK}"/>
<svg x="457" y="279" width="34" height="34" viewBox="0 0 100 100"><g opacity="0.98" filter="url(#invert)">{sm}</g></svg>
</g>'''


cards = "\n".join(board_card(i, 60 + ((i - 1) % 3) * 550, 187 + ((i - 1) // 3) * 450) for i in range(1, 7))
board = f'''<rect width="1770" height="1130" fill="#F5F6F3"/>
<defs><filter id="invert" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="table" tableValues="1 1"/><feFuncG type="table" tableValues="1 1"/><feFuncB type="table" tableValues="1 1"/></feComponentTransfer></filter></defs>
<text x="60" y="77" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="bold" letter-spacing="-2" fill="{INK}">holon</text>
<text x="60" y="117" font-family="Arial, Helvetica, sans-serif" font-size="23" fill="#536171">Seis caminhos para uma nova identidade</text>
<text x="1710" y="76" text-anchor="end" font-family="Georgia, Times New Roman, serif" font-size="34" fill="#596579">ὅλον</text>
<text x="1710" y="117" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#89919B">estudo inicial · 2026-10-04</text>
{cards}
<text x="60" y="1110" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#66717D">A escolha de direção define o símbolo; tipografia, cor e aplicações serão refinadas depois.</text>'''
(OUT / "holon-directions.svg").write_text(svg(board, "0 0 1770 1130", 1770, 1130), encoding="utf-8")


html_cards = []
for i, (name, concept, description, use) in enumerate(DIRECTIONS, 1):
    slug = ["orbita", "encaixe", "molduras", "greek", "rastro", "semente"][i - 1]
    html_cards.append(f'''<article class="card"><div class="card-head"><span>{i:02d} / 06</span><span>{escape(use)}</span></div>
<div class="preview"><div class="symbol"><img src="{i:02d}-{slug}.svg" alt="Símbolo {escape(name)}"></div><img class="lockup" src="{i:02d}-{slug}-wordmark.svg" alt="Assinatura Holon — {escape(name)}"></div>
<div class="copy"><h2>{escape(name)}</h2><span>{escape(concept)}</span><p>{escape(description)}</p></div>
<div class="sizes"><span>16 px</span><img width="16" height="16" src="{i:02d}-{slug}.svg" alt=""><span>32 px</span><img width="32" height="32" src="{i:02d}-{slug}.svg" alt=""><span>Monocromático</span><img width="40" height="40" src="{i:02d}-{slug}-mono.svg" alt=""></div>
</article>''')
page = '''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Holon — direções de logo</title>
<style>:root{font-family:Arial,Helvetica,sans-serif;color:#17243a;background:#f5f6f3}*{box-sizing:border-box}body{margin:0}main{max-width:1380px;padding:48px 28px 72px;margin:auto}header{display:flex;justify-content:space-between;align-items:start;margin-bottom:38px}h1{margin:0;font-size:54px;letter-spacing:-3px}header p{margin:8px 0 0;font-size:21px;color:#536171}header em{font:34px Georgia,serif;color:#596579}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{background:white;border:1px solid #e4e7e9;border-radius:24px;padding:24px;min-height:420px}.card-head{display:flex;justify-content:space-between;color:#89919b;font-size:13px;font-weight:bold}.preview{display:flex;align-items:center;gap:14px;margin:28px 0 30px}.symbol{width:118px;height:118px;flex:none;border-radius:20px;background:#f2f4f5;display:grid;place-items:center}.symbol img{width:86px;height:86px}.preview .lockup{width:220px;height:68px;object-fit:contain;object-position:left;max-width:calc(100% - 132px)}.copy h2{font-size:27px;margin:0 0 5px}.copy span{color:#5a6777}.copy p{color:#5a6777;line-height:1.45;min-height:64px}.sizes{border-top:1px solid #edf0f2;padding-top:16px;display:flex;align-items:center;gap:10px;color:#89919b;font-size:12px}.sizes img{margin-right:12px}footer{color:#66717d;margin-top:28px}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){main{padding:24px 16px 50px}.grid{grid-template-columns:1fr}header em{display:none}h1{font-size:44px}}</style></head><body><main><header><div><h1>holon</h1><p>Seis caminhos para uma nova identidade</p></div><em>ὅλον</em></header><section class="grid">'''+"\n".join(html_cards)+'''</section><footer>Estudo inicial. A direção escolhida pode ser refinada em tipografia, cor e aplicações.</footer></main></body></html>'''
(OUT / "index.html").write_text(page, encoding="utf-8")
