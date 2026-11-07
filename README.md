# Sistema de Precificação · Temperei

Sistema web de precificação comercial que roda **100% no navegador**: sem servidor, sem banco de dados, sem mensalidade. Feito para o GitHub Pages. Vem com a identidade da Temperei (cores tiradas da logo), mas serve para qualquer comércio.

## Como funciona (sem banco de dados)

**O arquivo Excel é a sua base de dados.** Nada fica guardado no navegador.

1. **Nova lista**: comece do zero, cadastre produtos e/ou importe arquivos.
2. **Salvar em Excel**: guarde o `.xlsx`. Ele leva os produtos e, numa aba oculta, loja, logo, custos, taxas e margens.
3. **Alimentar lista**: carregue o `.xlsx` de volta (ou uma lista de fornecedor em xlsx/csv/txt) e continue.

> ⚠️ Fechar ou atualizar a página **perde o que não foi salvo**. O sistema avisa antes de sair e mostra “Alterações não salvas” no menu.

## Telas

| Tela | O que faz |
|---|---|
| Início | Nova lista · Alimentar lista |
| Minha loja | Logo, nome, CNPJ, endereço, telefone; cores (sugeridas pela logo, editáveis) |
| Produtos | Cadastro, edição rápida, duplicar, excluir, busca, filtro, ordenação, colunas, ações em lote |
| Categorias | Criar, renomear, excluir (excluir categoria **não** exclui produtos) |
| Precificação | Preço do produto com detalhamento · Custos e despesas · Taxas de cartão · Margem e rateio |
| Importar arquivo | Leitura inteligente, mapeamento de colunas, prévia, seleção, aplicar, desfazer |
| Gerar PDF | Configuração + pré-visualização; só dados comerciais |
| Salvar em Excel | Planilha formatada, reimportável sem duplicar |

## Regras de cálculo

- Dinheiro em **centavos inteiros** (decimal.js). Arredondamento único: meio para cima, em centavos.
- **Margem ≠ markup.** Margem = lucro ÷ preço. Markup = lucro ÷ todos os custos (inclusive taxas). 30% de margem sobre custo R$ 10,00 dá R$ 14,29; 30% de markup dá R$ 13,00.
- **Gross-up**: `preço = custo efetivo ÷ (1 − margem − taxa do cartão − variáveis% − fixos%)`. Se o denominador for ≤ 0, o sistema bloqueia e explica.
- `custo efetivo = custo ÷ (1 − perda%) + custos adicionais + variáveis em R$ + fixos por unidade`.
- **Rateio dos fixos** (nunca o valor cheio por produto): por faturamento previsto (vira % do preço) ou por quantidade vendida (vira R$ por unidade).
- O detalhamento soma exatamente o preço; o lucro absorve a diferença de centavos do arredondamento.
- **Preço proporcional** sai do preço de venda já arredondado: R$ 59,90/kg → R$ 5,99 por 100 g; R$ 24,90/L → R$ 2,49 por 100 ml. Só converte unidades compatíveis (kg↔g, L↔ml); massa↔volume é bloqueado.

## Importação segura

- Aceita `.xlsx`, `.csv`, `.txt` (separador `;` `,` tabulação `|` ou colunas por espaços; UTF-8 ou Windows-1252).
- Acha a **tabela real** pela linha com mais cabeçalhos conhecidos (Produto/Descrição/Item, Categoria/Grupo/Classe, Custo/Preço de compra, Preço de venda/Valor, Unidade/Medida). Título, logo, endereço, telefone, rodapé, totais e linhas só com texto são **ignorados**.
- Cabeçalhos como `Custo/kg` também informam a unidade.
- Coluna genérica (“Preço”, “Valor”) sem coluna de custo exige confirmação do usuário.
- Classifica: novo · já existe · alterado · possível duplicado · incompleto · com erro.
- Com ID interno (Excel do sistema) casa por ID; sem ID, por nome normalizado (sem acento/caixa/espaços extras) + categoria + unidade. Nomes só parecidos **não** são unificados; mesmo nome com categoria/unidade diferente vira “possível duplicado” e você decide.
- **Só os novos vêm marcados.** Alterados e duplicados dependem de você marcar. Você escolhe quais campos atualizar (custo, preço, categoria…).
- Nunca exclui produtos. Nunca mexe em loja, custos, taxas, margens ou visual (a restauração de configurações de um Excel do sistema é uma caixa à parte, que você marca).
- **Desfazer última importação** reverte só o que ela fez (não apaga o que você cadastrou depois).

## Rodar no computador

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm test           # testes automatizados
npm run build      # gera a pasta dist/
npm run preview    # confere o build em http://localhost:4173
```

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie estes arquivos:
   ```bash
   git init
   git add .
   git commit -m "Sistema de precificação"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
   git push -u origin main
   ```
2. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Aguarde a aba **Actions** terminar (roda os testes, gera o build e publica). O endereço aparece em Settings → Pages: `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`.

O projeto usa `base: './'` e rotas por `#`, então funciona em qualquer endereço do GitHub Pages sem configurar o nome do repositório.

## Atualizar depois

Edite os arquivos, faça `git add . && git commit -m "..." && git push`. A publicação é automática. Se os testes falharem, nada é publicado.

## Estrutura

```
src/core/      dinheiro, unidades, motor de preço, ordenação (lógica pura, testada)
src/import/    leitura de texto, detecção da tabela, extração de linhas, classificação, aplicar/desfazer
src/export/    Excel (ExcelJS), PDF (jsPDF), paleta da logo
src/pages/     telas
src/state/     estado da lista em memória
src/ui/        componentes, tema (cores da logo), ícones
tests/         62+ testes (cálculos, importação, Excel, PDF)
public/logo.jpg  logo padrão (troque em “Minha loja”)
```

## Limites conhecidos

- Sem persistência no navegador, por escolha: salve o Excel.
- `.xls` (Excel antigo) não é lido; salve como `.xlsx` ou CSV.
- A pré-visualização do PDF usa o visualizador do navegador; em alguns celulares ela não aparece, mas o botão **Baixar PDF** funciona sempre.
- Não há sincronização entre aparelhos: leve o arquivo Excel.
