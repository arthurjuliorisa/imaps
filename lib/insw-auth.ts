import { checkMenuAuth, type MenuAction } from './menu-auth';

/** Owner-approved mapping: VIEW reads, CREATE existing submissions,
 * EDIT recovery/RESEND. DELETE authorizes no INSW operation. */
export function checkInswAuth(action: MenuAction = 'view') {
  return checkMenuAuth('/insw/logs', action);
}
