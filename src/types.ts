/** Valores monetários são SEMPRE guardados em centavos inteiros. Percentuais em "pontos" (20 = 20%). */

export interface Product {
  id: string;
  nome: string;
  /** '' = sem categoria */
  categoria: string;
  /** unidade de referência do preço (kg, g, L, ml, un, pacote, caixa ou personalizada) */
  unidade: string;
  custo: number | null;
  custosAdicionais: number;
  venda: number | null;
  /** base do preço proporcional, ex.: 100 g. null = sem preço proporcional */
  propQtd: number | null;
  propUnidade: string | null;
  observacoes: string;
  /** quantidade em estoque, na unidade do produto (opcional; usada no custo médio e no inventário) */
  estoque?: number | null;
  /** conteúdo de cada embalagem (pacote, frasco…), ex.: 250 g. Permite o preço proporcional de unidades de contagem */
  conteudoQtd?: number | null;
  conteudoUnidade?: string | null;
}

export interface ListState {
  nome: string;
  produtos: Product[];
  categorias: string[];
}

export interface Colors {
  primaria: string;
  destaque: string;
  fundo: string;
}

export interface StoreInfo {
  nomeFantasia: string;
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  telefone: string;
  informacoes: string;
  /** data URL da logo enviada; null = logo padrão do projeto */
  logo: string | null;
  cores: Colors;
}

export interface FixedCost {
  id: string;
  descricao: string;
  /** centavos por mês */
  valor: number;
}

export interface VariableCost {
  id: string;
  descricao: string;
  tipo: 'percentual' | 'valor';
  /** percentual: pontos (3 = 3% do preço) · valor: centavos por unidade vendida */
  valor: number;
}

export interface InstallmentFee {
  id: string;
  parcelas: number;
  taxa: number;
}

export interface Settings {
  custosFixos: FixedCost[];
  custosVariaveis: VariableCost[];
  /** perdas e desperdícios, % sobre o custo de aquisição */
  perdaPct: number;
  taxas: { debito: number; creditoVista: number; parcelado: InstallmentFee[] };
  /** forma de pagamento usada para o preço de tabela */
  pagamentoBase: string;
  margem: { modo: 'margem' | 'markup'; valor: number };
  rateio: {
    metodo: 'faturamento' | 'quantidade';
    /** centavos por mês */
    faturamentoPrevisto: number;
    quantidadePrevista: number;
  };
}

export type FieldKey =
  | 'id'
  | 'nome'
  | 'categoria'
  | 'unidade'
  | 'custo'
  | 'venda'
  | 'custosAdicionais'
  | 'base'
  | 'observacoes';

export type ColumnTarget = FieldKey | 'ignorar';

export interface ImportRecord {
  adicionados: string[];
  atualizados: Product[]; // estado ANTERIOR dos produtos atualizados
  categoriasAdicionadas: string[];
  quando: number;
  resumo: string;
}
