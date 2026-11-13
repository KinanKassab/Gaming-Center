import { ConflictError } from "@/core/errors";
import type { OrganizationActor } from "@/modules/identity/types";

export const CANNOT_MODIFY_SELF_REASON = "cannot_modify_self";
export const CANNOT_MODIFY_SELF_MESSAGE = "You cannot change your own membership";

/** Staff and owners administer other people; they never edit their own access here. */
export function assertNotSelfMembership(actor: OrganizationActor, membershipId: string): void {
  if (actor.membershipId === membershipId) {
    throw new ConflictError(CANNOT_MODIFY_SELF_MESSAGE, CANNOT_MODIFY_SELF_REASON);
  }
}
