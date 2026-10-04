from pathlib import Path
from math import sin, cos, pi, log, exp, sqrt
from html import escape
import json

OUT = Path(__file__).parent
INK = '#222520'
PAPER = '#F7F6F1'


def circle_path(cx, cy, r):
    return f'M {cx-r:g} {cy:g} a {r:g} {r:g} 0 1 0 {2*r:g} 0 a {r:g} {r:g} 0 1 0 {-2*r:g} 0 Z'


def ellipse_path(cx, cy, rx, ry):
    return f'M {cx-rx:g} {cy:g} a {rx:g} {ry:g} 0 1 0 {2*rx:g} 0 a {rx:g} {ry:g} 0 1 0 {-2*rx:g} 0 Z'


def leaf_path(scale=1, tx=0, ty=0):
    coords = [(17,83),(8,40),(40,8),(83,17),(92,60),(60,92),(17,83)]
    c = [(50+(x-50)*scale+tx, 50+(y-50)*scale+ty) for x,y in coords]
    return f'M{c[0][0]:g} {c[0][1]:g} C'+ ' '.join(f'{x:g} {y:g}' for x,y in c[1:4])+' C'+' '.join(f'{x:g} {y:g}' for x,y in c[4:])+'Z'


def spiral():
    phi = (1+sqrt(5))/2
    k = log(phi)/(pi/2)
    left, right, centers = [], [], []
    for i in range(401):
        t = 2.75*pi*i/400
        a = t-0.38
        r = 42*exp(-k*t)
        x,y = r*cos(a),r*sin(a)
        dx,dy = r*(-k*cos(a)-sin(a)),r*(-k*sin(a)+cos(a))
        norm = sqrt(dx*dx+dy*dy)
        w = 0.105*r+0.95
        nx,ny = -dy/norm*w,dx/norm*w
        left.append((x+nx,y+ny))
        right.append((x-nx,y-ny))
        centers.append((x,y,w))
    poly = left+right[::-1]
    minx,miny = min(x for x,y in poly),min(y for x,y in poly)
    maxx,maxy = max(x for x,y in poly),max(y for x,y in poly)
    scale = 80/max(maxx-minx,maxy-miny)
    cx,cy = (minx+maxx)/2,(miny+maxy)/2
    points = ' '.join(f'{50+(x-cx)*scale:.3f},{50+(y-cy)*scale:.3f}' for x,y in poly)
    caps = ''.join(f'<circle cx="{50+(x-cx)*scale:.3f}" cy="{50+(y-cy)*scale:.3f}" r="{w*scale:.3f}"/>' for x,y,w in [centers[0],centers[-1]])
    return f'<g fill="currentColor"><polygon points="{points}"/>{caps}</g>'


def symbols():
    # A zero repeats inside itself, displaced rather than concentric.
    eco = f'<g transform="rotate(28 50 50)" fill="currentColor" fill-rule="evenodd"><path d="{ellipse_path(50,50,30,40)} {ellipse_path(50,50,19,29)}"/><path d="{ellipse_path(52,59,10,15)} {ellipse_path(52,59,4.6,8.5)}"/></g>'
    # Two unequal lobes share one continuous curve.
    laco = '<g transform="rotate(-28 50 50)"><path d="M52 50C70 25 85 28 87 45C90 63 73 77 52 50C27 18 11 28 12 52C14 79 36 84 52 50Z" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></g>'
    germen = f'<path fill="currentColor" fill-rule="evenodd" d="{leaf_path()} {leaf_path(.68)} {leaf_path(.35)} {leaf_path(.15)}"/>'
    # Four complete diamonds assemble a larger diamond.
    parts = []
    for x,y in [(50,25),(75,50),(50,75),(25,50)]:
        parts.append(f'<path fill="currentColor" fill-rule="evenodd" d="M{x} {y-20}L{x+20} {y}L{x} {y+20}L{x-20} {y}Z M{x} {y-8}L{x+8} {y}L{x} {y+8}L{x-8} {y}Z"/>')
    mosaico = ''.join(parts)
    dobra = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(45 50 50)"><path d="M65 22H34Q22 22 22 34V66Q22 78 34 78H66Q78 78 78 66V49" stroke-width="9"/><path d="M56 39H45Q39 39 39 45V55Q39 61 45 61H56Q62 61 62 55V50" stroke-width="6" transform="rotate(180 50 50)"/></g></g>'
    celula = '<g fill="none" stroke="currentColor"><path d="M68.8 29.4A33 33 0 1 0 68.8 70.6" stroke-width="10" stroke-linecap="round"/><circle cx="72" cy="50" r="12.5" stroke-width="7"/><circle cx="72" cy="50" r="2.7" fill="currentColor" stroke="none"/></g>'
    # Phi is reinterpreted as a shared axis and two complete asymmetric loops.
    razao = '<g transform="rotate(28 50 50)" fill="none" stroke="currentColor" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"><path d="M50 10V90"/><path d="M50 31C21 23 11 45 19 61C25 75 38 76 50 69Z"/><path d="M50 31C70 26 80 37 78 48C76 60 62 62 50 57Z"/></g>'
    return [eco,laco,germen,mosaico,spiral(),dobra,celula,razao]


DATA = [
    ('Eco','eco','Zero recursivo','A mesma forma reaparece no próprio vazio.','Cada zero permanece uma figura inteira.', 'Um zero inclinado contém outro zero com as mesmas proporções. O deslocamento cria relação entre as duas escalas sem transformar o símbolo em um alvo.'),
    ('Laço','laco','Continuidade','Dois ciclos compartilham um único caminho.','As escalas mudam; o percurso continua.', 'Uma curva contínua reúne dois laços desiguais. O infinito aparece como continuidade e interdependência, com uma silhueta assimétrica.'),
    ('Gérmen','germen','Semente recursiva','A semente contém uma versão de si.','Cheio e vazio repetem o mesmo contorno.', 'Evolução da direção Semente: o contorno orgânico se repete em três escalas. A alternância entre matéria e vazio aproxima a marca da ideia de autossimilaridade.'),
    ('Mosaico','mosaico','Todo composto','Quatro formas completas criam outra forma.','A parte e o conjunto têm a mesma geometria.', 'Quatro losangos vazados formam um losango maior. A identidade de cada módulo permanece visível dentro da figura coletiva.'),
    ('Espiral','espiral','Progressão de escala','Uma curva envolve a própria origem.','O movimento aproxima o todo do núcleo.', 'Uma espiral logarítmica com redução de raio por φ a cada quarto de volta. A espessura acompanha a escala para manter um gesto contínuo e uma silhueta simples.'),
    ('Dobra','dobra','Moldura recursiva','Uma moldura retorna dentro de si.','O giro sugere uma próxima camada.', 'Evolução da direção Molduras: a geometria gira e se repete numa escala menor. As aberturas evitam o fechamento completo e sugerem continuidade além do recorte.'),
    ('Elo','elo','Parte constitutiva','O círculo menor completa o maior.','Uma unidade também funciona como vínculo.', 'Uma unidade circular participa da borda de uma estrutura maior. A pequena forma deixa de ser apenas conteúdo: ela ajuda a constituir o todo.'),
    ('Razão','razao','Eixo compartilhado','Dois volumes pertencem ao mesmo eixo.','Uma interpretação abstrata de φ.', 'Dois laços de dimensões diferentes se articulam ao redor de um eixo inclinado. A referência à letra phi é gestual, com proporções e construção próprias.'),
]
ART = symbols()


def svg(content, viewbox='0 0 100 100', color=INK, extra=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" style="color:{color}" {extra}>{content}</svg>'


for i,(_,slug,*_) in enumerate(DATA):
    (OUT/f'{i+1:02d}-{slug}.svg').write_text(svg(ART[i]),encoding='utf-8')
    (OUT/f'{i+1:02d}-{slug}-inverse.svg').write_text(svg(ART[i],color=PAPER),encoding='utf-8')
    lockup=f'<svg x="0" y="0" width="100" height="100" viewBox="0 0 100 100">{ART[i]}</svg><text x="125" y="69" font-family="Arial,Helvetica,sans-serif" font-weight="600" font-size="60" letter-spacing="-3" fill="currentColor">holon</text>'
    (OUT/f'{i+1:02d}-{slug}-lockup.svg').write_text(svg(lockup,'0 0 320 100'),encoding='utf-8')


def card(i,x,y):
    title,slug,sub,line1,line2,_=DATA[i]
    return f'''<g transform="translate({x} {y})">
<rect width="396" height="420" rx="12" fill="#FFFFFF" stroke="#DDDFD7"/>
<text x="24" y="36" font-family="Arial,Helvetica,sans-serif" font-size="14" letter-spacing="1" fill="#7B8276">{i+1:02d}</text>
<text x="372" y="36" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#7B8276">{escape(sub)}</text>
<svg x="103" y="66" width="190" height="190" viewBox="0 0 100 100" style="color:{INK}">{ART[i]}</svg>
<text x="24" y="304" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="600" letter-spacing="-.6" fill="{INK}">{title}</text>
<text x="24" y="338" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#65705E">{escape(line1)}</text>
<text x="24" y="360" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#65705E">{escape(line2)}</text>
<line x1="24" y1="384" x2="322" y2="384" stroke="#ECEEE7"/>
<text x="24" y="404" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#8E948A">holon / estudo 02</text>
<rect x="340" y="373" width="34" height="34" rx="8" fill="{INK}"/>
<svg x="345" y="378" width="24" height="24" viewBox="0 0 100 100" style="color:{PAPER}">{ART[i]}</svg>
</g>'''

board=f'''<rect width="1732" height="1098" fill="{PAPER}"/>
<text x="48" y="75" font-family="Arial,Helvetica,sans-serif" font-size="43" font-weight="600" letter-spacing="-2" fill="{INK}">holon</text>
<text x="1684" y="67" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="14" letter-spacing="1.5" fill="#727B69">FILOSOFIA × GEOMETRIA</text>
<text x="48" y="119" font-family="Arial,Helvetica,sans-serif" font-size="23" fill="#65705E">Uma forma inteira. Uma parte de outra.</text>
<text x="1684" y="114" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#828A7B">Explorações de identidade · 2026-10-04</text>
'''+''.join(card(i,48+(i%4)*413,161+(i//4)*437) for i in range(8))+f'''
<text x="48" y="1073" font-family="Arial,Helvetica,sans-serif" font-size="15" fill="#727B69">Autossimilaridade · continuidade · escala · cheio e vazio</text>
<text x="1684" y="1073" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="#828A7B">Símbolos exploratórios em uma única cor</text>'''
(OUT/'holon-abstract.svg').write_text(svg(board,'0 0 1732 1098',extra='width="1732" height="1098"'),encoding='utf-8')

cards=[]
for i,(title,slug,sub,line1,line2,detail) in enumerate(DATA):
    cards.append(f'''<button class="card" data-index="{i}" aria-label="Explorar {title}"><div class="eyebrow"><span>{i+1:02d}</span><span>{sub}</span></div><div class="mark">{svg(ART[i])}</div><h2>{title}</h2><p>{line1}<br>{line2}</p><div class="foot"><span>Ampliar e comparar →</span><span class="small">{svg(ART[i])}</span></div></button>''')
html='''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Holon — Filosofia e geometria</title><style>
:root{--ink:#222520;--paper:#f7f6f1;--card:#fff;--muted:#65705e;--line:#dddfd7;font-family:Arial,Helvetica,sans-serif;color:var(--ink);background:var(--paper)}*{box-sizing:border-box}body{margin:0}body.dark{--ink:#f7f6f1;--paper:#20231f;--card:#282c26;--muted:#b3baa9;--line:#40463a}main{max-width:1510px;margin:auto;padding:42px 26px}header{display:flex;justify-content:space-between;gap:24px;align-items:center;margin-bottom:30px}h1{font-size:46px;margin:0;letter-spacing:-2px;font-weight:600}.subtitle{margin:8px 0 0;color:var(--muted);font-size:19px}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}button,a{touch-action:manipulation}.control,a{background:transparent;color:var(--ink);border:1px solid var(--line);padding:12px 16px;border-radius:24px;text-decoration:none;font-size:14px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{padding:22px 20px 16px;background:var(--card);border:1px solid var(--line);border-radius:12px;color:var(--ink);text-align:left;cursor:pointer;transition:transform 150ms,border-color 150ms}.card:hover{transform:translateY(-3px);border-color:var(--muted)}.card:focus-visible,.control:focus-visible,a:focus-visible{outline:3px solid #848d75;outline-offset:4px}.eyebrow{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:12px}.mark{height:215px;display:grid;place-items:center}.mark svg{width:166px;height:166px;max-width:100%;color:var(--ink)!important}h2{font-size:25px;letter-spacing:-.5px;margin:12px 0 12px}p{font-size:13px;line-height:1.6;color:var(--muted);margin:0;min-height:44px}.foot{margin-top:22px;display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px}.small{display:grid;place-items:center;background:var(--ink);width:34px;height:34px;border-radius:8px}.small svg{width:24px;height:24px;color:var(--paper)!important}footer{color:var(--muted);font-size:14px;margin-top:28px}dialog{max-width:880px;width:calc(100% - 32px);border:1px solid var(--line);border-radius:18px;padding:28px;background:var(--card);color:var(--ink)}dialog::backdrop{background:#1119;backdrop-filter:blur(6px)}.detail-head{display:flex;justify-content:space-between;align-items:center}.detail-head h2{margin:0}.close{border:none;font-size:24px;background:none;color:var(--ink);cursor:pointer}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;padding:26px 0}.detail-mark{display:grid;place-items:center;min-height:290px}.detail-mark svg{width:270px;max-width:100%;color:var(--ink)!important}.detail-copy p{font-size:16px;margin-bottom:24px}.size-line{display:flex;gap:24px;align-items:center;margin:18px 0 24px}.size-line svg{color:var(--ink)!important}.detail-actions{display:flex;gap:10px;flex-wrap:wrap}.note{font-size:13px;color:var(--muted)}@media(max-width:1100px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){main{padding:25px 16px}header{align-items:start;flex-direction:column}.grid{gap:12px}.card{padding:16px 12px}.mark{height:160px}.mark svg{width:130px;height:130px}.eyebrow{font-size:10px}.foot>span:first-child{display:none}h2{font-size:22px}.card p{font-size:12px}.detail-grid{grid-template-columns:1fr;gap:10px}.detail-mark{min-height:220px}.detail-mark svg{width:210px}.detail-copy p{font-size:15px}}@media(prefers-reduced-motion:reduce){.card{transition:none}}
</style></head><body><main><header><div><h1>holon</h1><p class="subtitle">Uma forma inteira. Uma parte de outra.</p></div><div class="controls"><button class="control" id="theme" aria-pressed="false">Alternar claro / escuro</button><a href="holon-abstract.svg" download>Baixar prancha SVG</a></div></header><section class="grid">'''+''.join(cards)+'''</section><footer>Estudo 02 · Autossimilaridade, continuidade, escala, cheio e vazio. Clique em um símbolo para vê-lo ampliado e em tamanhos pequenos.</footer></main><dialog id="detail"><div class="detail-head"><h2 id="detail-title"></h2><button class="close" aria-label="Fechar">×</button></div><div class="detail-grid"><div class="detail-mark"></div><div class="detail-copy"><p id="detail-description"></p><div class="note">16 px · 24 px · 40 px</div><div class="size-line"></div><div class="detail-actions"><a id="download-symbol" download>SVG do símbolo</a><a id="download-lockup" download>SVG com nome</a></div></div></div></dialog><script>
const data='''+json.dumps(DATA,ensure_ascii=False)+''';
const art='''+json.dumps(ART,ensure_ascii=False)+''';
const dialog=document.querySelector('#detail');
document.querySelector('#theme').addEventListener('click',e=>{document.body.classList.toggle('dark');e.currentTarget.setAttribute('aria-pressed',String(document.body.classList.contains('dark')))});
document.querySelectorAll('.card').forEach(button=>button.addEventListener('click',()=>{const i=Number(button.dataset.index);const [name,slug,subtitle,line1,line2,description]=data[i];document.querySelector('#detail-title').textContent=String(i+1).padStart(2,'0')+' / '+name;document.querySelector('#detail-description').textContent=description;document.querySelector('.detail-mark').innerHTML='<svg viewBox="0 0 100 100">'+art[i]+'</svg>';document.querySelector('.size-line').innerHTML=[16,24,40].map(size=>'<svg width="'+size+'" height="'+size+'" viewBox="0 0 100 100">'+art[i]+'</svg>').join('');document.querySelector('#download-symbol').href=String(i+1).padStart(2,'0')+'-'+slug+'.svg';document.querySelector('#download-lockup').href=String(i+1).padStart(2,'0')+'-'+slug+'-lockup.svg';dialog.showModal()}));
document.querySelector('.close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
</script></body></html>'''
(OUT/'index.html').write_text(html,encoding='utf-8')
(OUT/'README.md').write_text('# Holon — estudo 02\n\nExplorações vetoriais criadas em 2026-10-04. Os fractais, o símbolo phi e as direções Molduras e Semente servem como referências conceituais.\n\n'+ '\n\n'.join(f'## {i+1:02d} — {d[0]}\n\n{d[-1]}' for i,d in enumerate(DATA))+'\n\nOs símbolos usam geometria vetorial editável. A tipografia das assinaturas é provisória e depende das fontes disponíveis no dispositivo. As propostas ainda precisam de refinamento óptico após a escolha de uma direção.\n',encoding='utf-8')
