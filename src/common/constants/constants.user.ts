export const USER_SAFE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  alternatePhone: true,
  dob: true,
  username: true,
  status: true,
  roleId: true,
  role: {
    select: {
      id: true,
      name: true,
      description: true,
    },
  },
  teamId: true,
  team: {
    select: {
      id: true,
      name: true,
      description: true,
    },
  },
  managerId: true,
  createdAt: true,
  updatedAt: true,
} as const;
