import {HttpError} from '../http/errors.js';
/** Configuration revisions use a saved final framework; survey corrections belong to Design. */
export function frameworkCosting(_base:any,_survey:any):never {throw new HttpError(422,'UBL pre-agreed BOQ quantities cannot be edited manually. Change the approved Solution ID through the UBL revision route, or return survey corrections to Design.');}
