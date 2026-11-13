export type WizardStaffMember = {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string | null;
  status: string;
  joinedAt: string | null;
  roles: Array<{ roleId: string; code: string; name: string; status: string }>;
};
