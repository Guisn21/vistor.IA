# Vistor.IA Generator — v0.7.0

App web instalável (PWA) para registrar vistorias no celular (Android e iPhone). Funciona sem internet e sem IA. Tudo fica no aparelho até o usuário baixar o ZIP.

## Fluxo
- Tela principal: **Cadastrar operação** (tomador, número 0000.000-00, empreendimento) ou **Selecionar operação existente** (busca pelos 3 campos; lixeira para excluir).
- Operação: **Iniciar vistoria** (abre a câmera do app; data = hoje), lápis para editar a operação, **Continuar vistoria pausada**, **Consultar vistorias** (só as vistorias da operação; filtro por data de e até; lixeira para excluir).
- Foto: câmera dentro do app (um toque salva e abre a foto; botão de lente quando o celular oferece; reserva "Câmera do celular"). Sem GPS, o app avisa e a foto vai sem coordenadas. A bússola registra a direção da câmera.
- Sobre a foto, três áreas: lupa (tela cheia), microfone (grava na hora, CONCLUIR vincula à foto) e observação escrita. Áudio e texto são opcionais e podem ser usados juntos.
- Botões: Cancelar vistoria (confirmação dupla), Descartar foto, Próxima foto e Concluir vistoria (com identificação opcional).
- Durante a vistoria, o botão ▦ (com o número de fotos) abre a grade das fotos já tiradas; tocar numa foto abre a foto para editar.
- Na consulta, tocar numa foto mostra a observação e o áudio. Vistoria concluída: só leitura. Vistoria pausada: edita a observação e grava áudio novo (substitui o anterior).
- O ícone de casa na barra superior volta direto para a tela principal.
- Concluir não gera o ZIP. O ZIP ("1095345-v01-ddmmaaaa-Identificacao.zip") sai pelo botão Baixar ZIP ou pela seta na consulta, com as fotos ("pic-ddmmaaaa-hhmmss.jpeg", GPS e direção no EXIF), os áudios ("aud-ddmmaaaa-hhmmss.m4a"), o relatório .DOCX e um mapa .kml (Google Earth) com uma seta por foto.
- Vistoria concluída pode ser reaberta para editar; a identificação pode ser editada.
- Numeração: operação → V01… → V01-F001…
- Na consulta, "Excluir fotos e dados do celular" apaga fotos, áudios, coordenadas e observações. Ficam registrados a operação, o empreendimento, o tomador, a data e a identificação.

## Colocar no ar
Publicado em https://guisn21.github.io/vistor.IA/ (repositório github.com/Guisn21/vistor.ia, GitHub Pages pela branch main).

É preciso hospedar esta pasta em um endereço **https** (por exemplo GitHub Pages ou Netlify), porque câmera, GPS e microfone só funcionam em https. Para instalar: no iPhone, use Safari → Compartilhar → Adicionar à Tela de Início; no Android, use Chrome → ⋮ → Instalar app.

## Limitações conhecidas
- No iPhone, o Safari pode apagar os dados de sites que ficam 7 dias sem uso. Apps instalados na Tela de Início não entram nessa regra, por isso use sempre o ícone.
- Um app web não consegue ligar o GPS sozinho. Ele pede a permissão e orienta o usuário quando a localização está desligada.
- Testado apenas em Chromium com câmera, GPS e microfone simulados. Ainda falta testar em aparelhos reais.

## Atualizações
Ao publicar uma nova versão, altere `CACHE` em `sw.js`.

## Bibliotecas incluídas (offline)
piexifjs 1.0.6 (MIT), JSZip 3.10 (MIT/GPLv3), docx 9.12 (MIT).
