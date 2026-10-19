# Vistor.IA Generator — v0.6.1

App web instalável (PWA) para registrar vistorias no celular (Android e iPhone). Funciona sem internet e sem IA. Tudo fica no aparelho até o usuário baixar o ZIP.

## Fluxo
- Tela principal: **Cadastrar operação** (tomador, número 0000.000-00, empreendimento) ou **Selecionar operação existente** (busca pelos 3 campos; lixeira para excluir).
- Operação: **Início rápido de vistoria** (abre a câmera; data = hoje), **Continuar vistoria pausada**, **Consultar vistorias** (filtros por data, operação, tomador e empreendimento; lixeira para excluir).
- Foto: só é salva com localização. Sobre a foto, três áreas: lupa (tela cheia), microfone (grava na hora, CONCLUIR vincula à foto) e observação escrita. Áudio e texto são opcionais e podem ser usados juntos.
- Botões: Cancelar vistoria (confirmação dupla), Descartar foto, Próxima foto e Concluir vistoria (com identificação opcional).
- Durante a vistoria, o botão ▦ (com o número de fotos) abre a grade das fotos já tiradas; tocar numa foto abre a foto para editar.
- Na consulta, tocar numa foto mostra a observação e o áudio. Vistoria concluída: só leitura. Vistoria pausada: edita a observação e grava áudio novo (substitui o anterior).
- O ícone de casa na barra superior volta direto para a tela principal.
- Ao concluir, é gerado um ZIP com as fotos ("ddmmaaaa - hhmmss.jpg", GPS no EXIF), os áudios ("ddmmaaaa - hhmmss - audio.m4a") e o relatório .DOCX. No relatório, a coluna "Áudio" traz o nome do arquivo de áudio da foto (ou "—").
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
