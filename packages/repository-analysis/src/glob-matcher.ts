import {
  globToRegex as domainGlobToRegex,
  matchesAnyPathGlob as domainMatchesAnyPathGlob,
  matchesPathGlob as domainMatchesPathGlob,
} from "@holon/domain";

export const globToRegex = domainGlobToRegex;
export const matchesAnyPathGlob = domainMatchesAnyPathGlob;
export const matchesPathGlob = domainMatchesPathGlob;
