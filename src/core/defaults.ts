import type { Settings, StoreInfo } from '../types';
import { newKey } from './normalize';

/** Cores amostradas da logo Temperei. */
export const LOGO_COLORS = {
  primaria: '#B03818', // terracota do pilão
  destaque: '#64703A', // oliva das folhas
  fundo: '#EFDFC6', // creme da logo
};

export function defaultStore(): StoreInfo {
  return {
    nomeFantasia: 'Temperei',
    razaoSocial: '',
    cnpj: '',
    endereco: '',
    telefone: '',
    informacoes: 'Produtos Naturais · Especiarias',
    logo: null,
    cores: { ...LOGO_COLORS },
  };
}

export function defaultSettings(): Settings {
  return {
    custosFixos: [],
    custosVariaveis: [],
    perdaPct: 0,
    taxas: {
      debito: 0,
      creditoVista: 0,
      parcelado: [
        { id: newKey(), parcelas: 2, taxa: 0 },
        { id: newKey(), parcelas: 3, taxa: 0 },
      ],
    },
    pagamentoBase: 'credito_vista',
    margem: { modo: 'margem', valor: 30 },
    rateio: { metodo: 'faturamento', faturamentoPrevisto: 0, quantidadePrevista: 0 },
  };
}
