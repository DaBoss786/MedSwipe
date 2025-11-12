// referral.js - Handles the user-facing referral system logic

import { auth } from './firebase-config.js'; // We need auth to get the user's ID
import { isIosNativeApp } from './platform.js';

document.addEventListener('DOMContentLoaded', () => {
    // Get all the necessary elements from the DOM
    const referralCard = document.getElementById('referralCard');
    const referralModal = document.getElementById('referralModal');
    const referralLinkInput = document.getElementById('referralLinkInput');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const copyConfirmation = document.getElementById('copyConfirmation');
    const closeModalBtn = referralModal ? referralModal.querySelector('.close-modal') : null;

    const hideReferralCardForIos = isIosNativeApp();

    if (hideReferralCardForIos) {
        if (referralCard) {
            referralCard.remove(); // Ensure iOS native users never see or interact with the referral card
        }
    } else {
        if (!referralCard) {
            console.log("Referral system elements not found, referral logic will not run.");
            return;
        }

        // --- 1. Logic to Show/Hide the Referral Card ---
        // Listen for the global auth state change event dispatched from auth.js
        window.addEventListener('authStateChanged', (event) => {
            const authState = event.detail;
            
            // A user is eligible if they have a paid tier OR if they have an active trial.
            const isEligible = authState.isRegistered && 
                               (authState.accessTier === 'board_review' || 
                                authState.accessTier === 'cme_annual' ||
                                authState.hasActiveTrial === true); // Check for an active trial explicitly

            if (isEligible) {
                referralCard.style.display = 'block';
            } else {
                referralCard.style.display = 'none';
            }
        });

        // --- 2. Logic to Open the Modal ---
        referralCard.addEventListener('click', () => {
            if (!auth.currentUser || auth.currentUser.isAnonymous) {
                alert("An error occurred. Please make sure you are logged in.");
                return;
            }

            // Generate the unique referral link
            const userId = auth.currentUser.uid;
            const referralLink = `https://medswipeapp.com/index.html?ref=${userId}`;

            // Populate the input field and show the modal
            if (referralLinkInput) {
                referralLinkInput.value = referralLink;
            }
            if (referralModal) {
                referralModal.style.display = 'flex';
            }
            if (copyConfirmation) {
                copyConfirmation.textContent = ''; // Clear any previous confirmation message
            }
        });

        // --- 3. Logic for the "Copy Link" Button ---
        if (copyLinkBtn && referralLinkInput && copyConfirmation) {
            copyLinkBtn.addEventListener('click', () => {
                referralLinkInput.select(); // Select the text
                navigator.clipboard.writeText(referralLinkInput.value).then(() => {
                    // Success!
                    copyConfirmation.textContent = 'Copied to clipboard!';
                    copyLinkBtn.textContent = 'Copied!';
                    
                    // Reset the message and button text after a few seconds
                    setTimeout(() => {
                        copyConfirmation.textContent = '';
                        copyLinkBtn.textContent = 'Copy';
                    }, 2500);

                }).catch(err => {
                    // Error
                    console.error('Failed to copy text: ', err);
                    copyConfirmation.textContent = 'Could not copy. Please copy manually.';
                });
            });
        }

        // --- 4. Logic to Close the Modal ---
        const closeModal = () => {
            if (referralModal) {
                referralModal.style.display = 'none';
            }
        };

        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', closeModal);
        }
        if (referralModal) {
            referralModal.addEventListener('click', (event) => {
                // If the user clicks on the dark background overlay, close the modal
                if (event.target === referralModal) {
                    closeModal();
                }
            });
        }
    }

    // --- START: New Logic for Referee Experience ---

    // This function runs on page load to detect a referral link and save the ID.
    const handleReferralLink = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const referrerId = urlParams.get('ref');

        if (referrerId) {
            console.log(`Referral link detected. Referrer ID: ${referrerId}`);
            // Store it in localStorage for persistence across sessions.
            localStorage.setItem('medswipeReferrerId', referrerId);

            // Clean the URL to remove the '?ref=...' part so it doesn't get processed again on refresh.
            const newUrl = window.location.pathname + window.location.hash;
            history.replaceState(null, '', newUrl);
        }
    };

    // This function checks localStorage and shows the banner if an ID is found.
    // We make it global so app.js can call it when the registration form is opened.
    window.displayReferralBanner = () => {
        const referrerId = localStorage.getItem('medswipeReferrerId');
        const banner = document.getElementById('referralOfferBanner');

        if (referrerId && banner) {
            console.log("Referrer ID found in localStorage. Displaying offer banner.");
            banner.style.display = 'block';
        } else if (banner) {
            banner.style.display = 'none';
        }
    };

    // Run the link detection logic as soon as the page loads.
    handleReferralLink();

    // --- END: New Logic for Referee Experience ---
});
