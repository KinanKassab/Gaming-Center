import { APIError } from "better-auth/api";
import { ConflictError, ValidationError } from "@/core/errors";
import type { AuthAccountProvisioner } from "@/modules/identity/types";
import type { AppAuth } from "@/auth/auth";

/**
 * Implements the identity module's AuthAccountProvisioner port on top of
 * Better Auth. autoSignIn is disabled in createAuth, so provisioning an
 * account never creates a login session for the new user.
 */
export function createAuthAccountProvisioner(auth: AppAuth): AuthAccountProvisioner {
  return async ({ email, password, name }) => {
    try {
      const result = await auth.api.signUpEmail({ body: { email, password, name } });
      return { authSubject: result.user.id };
    } catch (error) {
      if (error instanceof APIError) {
        const code = (error.body as { code?: string } | undefined)?.code;
        if (code === "USER_ALREADY_EXISTS" || error.status === "UNPROCESSABLE_ENTITY") {
          throw new ConflictError(
            "An account with this email already exists; attach the existing user instead",
          );
        }
        throw new ValidationError(error.message);
      }
      throw error;
    }
  };
}
