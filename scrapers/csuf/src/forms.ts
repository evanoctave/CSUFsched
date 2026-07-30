import type { SearchCriteria } from './types.ts';

export const ENVELOPE_FIELDS: Record<string, string> = {
  ICAJAX: '1',
  ICNAVTYPEDROPDOWN: '0',
  ICType: 'Panel',
  ICElementNum: '0',
  ICXPos: '0',
  ICYPos: '0',
  ResponsetoDiffFrame: '-1',
  TargetFrameName: 'None',
  FacetPath: 'None',
  ICFocus: '',
  ICChanged: '-1',
  ICSkipPending: '0',
  ICAutoSave: '0',
  ICResubmit: '0',
  ICActionPrompt: 'false',
  ICBcDomData: '',
  ICFind: '',
  ICAddCount: '',
  ICAppClsData: '',
};

// PeopleSoft rejects a search with fewer than two criteria, so subject always
// travels with the catalog-number floor.
export function buildSearchFields(c: SearchCriteria): Record<string, string> {
  return {
    'CLASS_SRCH_WRK2_INSTITUTION$31$': 'FLCMP',
    'CLASS_SRCH_WRK2_STRM$35$': c.termCode,
    'SSR_CLSRCH_WRK_SUBJECT_SRCH$0': c.subject,
    'SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1': 'G',
    'SSR_CLSRCH_WRK_CATALOG_NBR$1': '0',
    'SSR_CLSRCH_WRK_ACAD_CAREER$2': c.career,
    'SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3': 'N',
    'SSR_CLSRCH_WRK_CRSE_ATTR$4': '',
    'SSR_CLSRCH_WRK_CRSE_ATTR_VALUE$4': '',
    'SSR_CLSRCH_WRK_LOCATION$5': '',
    'SSR_CLSRCH_WRK_DESCR$6': '',
  };
}
