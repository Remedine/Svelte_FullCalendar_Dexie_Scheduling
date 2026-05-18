import { browser } from '$app/environment';
import { db, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';

export const currentUser = $state<User | null>(null);

export async function login(name: string, pin: string): Promise<{ success: boolean; user?: User; message?: string}> {
    const user = await db.users.where('name').equals(name).first();

    if (!user || !user.active) {
        return { success: false, message: 'User not found or inactive'};
    }

    const isValid = await bcrypt.compare(pin, user.pinHash);
    if (!isValid) {
        return { success: false, message: 'Incorrect PIN' };
    }

    currentUser.value = user;
    localStorage.setItem('currentUserId', user.id!.toString());

    return { success: true, user };
}

export async function logout() {
    currentUser.value = null;
    localStorage.removeItem('currentUserId');
}

export async function requirePhotoUpdate(userId: number) {
    await db.users.update(userId, {forcePhotoUpdate: true});
}

//Auto-restore session on app load
if (browser) {
    const saveId = localStorage.getItem('currentUserId');
    if (saveId) {
        db.users.get(Number(saveId)).then(user => {
            if (user && user.active) {
                currentUser.value = user;
            }
        });
    }
}