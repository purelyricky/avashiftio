'use server';

import { ID, Query } from "node-appwrite";
import { createAdminClient, createSessionClient } from "@/lib/actions/appwrite";
import { cookies } from "next/headers";
import { parseStringify } from "../utils";

const getCollectionIdForRole = (role: UserRole) => {
  switch (role) {
    case 'admin': return process.env.APPWRITE_ADMINS_COLLECTION_ID;
    case 'client': return process.env.APPWRITE_CLIENTS_COLLECTION_ID;
    case 'student': return process.env.APPWRITE_STUDENTS_COLLECTION_ID;
    case 'shiftLeader': return process.env.APPWRITE_SHIFT_LEADERS_COLLECTION_ID;
    case 'gateman': return process.env.APPWRITE_GATEMEN_COLLECTION_ID;
    default: throw new Error('Invalid role');
  }
};

const findUserInCollection = async (database: any, email: string) => {
  const collections = [
    { id: process.env.APPWRITE_ADMINS_COLLECTION_ID!, role: 'admin' as UserRole },
    { id: process.env.APPWRITE_CLIENTS_COLLECTION_ID!, role: 'client' as UserRole },
    { id: process.env.APPWRITE_STUDENTS_COLLECTION_ID!, role: 'student' as UserRole },
    { id: process.env.APPWRITE_SHIFT_LEADERS_COLLECTION_ID!, role: 'shiftLeader' as UserRole },
    { id: process.env.APPWRITE_GATEMEN_COLLECTION_ID!, role: 'gateman' as UserRole },
  ];

  for (const collection of collections) {
    try {
      const response = await database.listDocuments(
        process.env.APPWRITE_DATABASE_ID!,
        collection.id,
        [Query.equal('email', [email])]
      );

      if (response.documents.length > 0) {
        return {
          ...response.documents[0],
          role: collection.role
        };
      }
    } catch (error) {
      console.error(`Error checking collection ${collection.id}:`, error);
    }
  }

  return null;
};

export const signUp = async ({ role, ...userData }: SignUpWithRoleData) => {
  const { email, password, firstName, lastName, phone } = userData;
  
  try {
    const { account, database } = await createAdminClient();

    // Create Appwrite account
    const newAccount = await account.create(
      ID.unique(), 
      email, 
      password, 
      `${firstName} ${lastName}`
    );

    // Base user data that's common to all roles
    const baseUserData = {
      userId: newAccount.$id,
      role, // Direct role assignment
      firstName,
      lastName,
      email,
      phone: phone || null,
      createdAt: new Date().toISOString()
    };

    // Add role-specific fields
    const additionalFields: Record<UserRole, object> = {
      student: {
        dateOfBirth: null,
        availabilityStatus: 'active',
        punctualityScore: 100.0,
        rating: 5.0
      },
      admin: {},
      client: {},
      shiftLeader: {},
      gateman: {
        clientId: null
      }
    };

    // Create user document in appropriate collection
    const collectionId = getCollectionIdForRole(role);
    await database.createDocument(
      process.env.APPWRITE_DATABASE_ID!,
      collectionId!,
      ID.unique(),
      {
        ...baseUserData,
        ...additionalFields[role]
      }
    );

    return true;
  } catch (error) {
    console.error('Error in signUp:', error);
    throw error;
  }
};

export const signIn = async ({ email, password }: LoginUser) => {
  try {
    const { account, database } = await createAdminClient();
    
    // Create session
    const session = await account.createEmailPasswordSession(email, password);
    
    // Find user data in collections using email
    const userData = await findUserInCollection(database, email);
    
    if (!userData) {
      throw new Error('User not found');
    }

    // Set session cookie
    cookies().set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    // Return user data including role
    return {
      ...userData,
      role: userData.role
    };
  } catch (error) {
    console.error('Error in signIn:', error);
    throw error;
  }
};

//Get Logged In user

export async function getUserInfo({ userId }: getUserInfoProps): Promise<UserResponse> {
    try {
      const { database } = await createAdminClient();
      
      const collections = [
        { id: process.env.APPWRITE_ADMINS_COLLECTION_ID!, role: 'admin' as UserRole },
        { id: process.env.APPWRITE_CLIENTS_COLLECTION_ID!, role: 'client' as UserRole },
        { id: process.env.APPWRITE_STUDENTS_COLLECTION_ID!, role: 'student' as UserRole },
        { id: process.env.APPWRITE_SHIFT_LEADERS_COLLECTION_ID!, role: 'shiftLeader' as UserRole },
        { id: process.env.APPWRITE_GATEMEN_COLLECTION_ID!, role: 'gateman' as UserRole },
      ];
  
      for (const collection of collections) {
        try {
          const response = await database.listDocuments(
            process.env.APPWRITE_DATABASE_ID!,
            collection.id,
            [Query.equal('userId', [userId])]
          );
  
          if (response.documents.length > 0) {
            const doc = response.documents[0];
            
            // Create base user data from document
            const baseUserData: BaseUser = {
              userId: doc.userId,
              role: collection.role,
              firstName: doc.firstName,
              lastName: doc.lastName,
              email: doc.email,
              phone: doc.phone || null,
              createdAt: doc.$createdAt
            };
  
            let userData: User;
            
            if (collection.role === 'student') {
              userData = {
                ...baseUserData,
                role: 'student',
                dateOfBirth: doc.dateOfBirth || null,
                availabilityStatus: doc.availabilityStatus || 'inactive',
                punctualityScore: Number(doc.punctualityScore) || 100,
                rating: Number(doc.rating) || 5.0
              } as StudentUser;
            } else if (collection.role === 'gateman') {
              userData = {
                ...baseUserData,
                role: 'gateman',
                clientId: doc.clientId || null
              } as GatemanUser;
            } else {
              userData = baseUserData;
            }
  
            return parseStringify({
              status: 'success',
              data: userData
            });
          }
        } catch (error) {
          console.error(`Error checking collection ${collection.id}:`, error);
          continue;
        }
      }
  
      return parseStringify({
        status: 'error',
        data: null,
        message: 'User not found'
      });
    } catch (error) {
      console.error('Error in getUserInfo:', error);
      return parseStringify({
        status: 'error',
        data: null,
        message: 'Internal server error'
      });
    }
  }
  
  export async function getLoggedInUser(): Promise<UserResponse> {
    try {
      const { account } = await createSessionClient();
      
      const currentUser = await account.get();
      
      if (!currentUser) {
        return parseStringify({
          status: 'error',
          data: null,
          message: 'No user session found'
        });
      }
  
      return await getUserInfo({ userId: currentUser.$id });
    } catch (error) {
      console.error('Error in getLoggedInUser:', error);
      return parseStringify({
        status: 'error',
        data: null,
        message: 'Failed to get logged in user'
      });
    }
  }

//Function for Getting Logged In User End

export const logoutAccount = async () => {
  try {
    const { account } = await createSessionClient();
    cookies().delete('appwrite-session');
    await account.deleteSession('current');
  } catch (error) {
    return null;
  }
};