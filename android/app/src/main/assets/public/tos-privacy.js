// TOS and Privacy Policy Modal Handlers
document.addEventListener('DOMContentLoaded', function() {
  // Get the modal elements
  const termsOfServiceModal = document.getElementById('termsOfServiceModal');
  const privacyPolicyModal = document.getElementById('privacyPolicyModal');
  const closeModalButtons = document.querySelectorAll('.close-modal');
  
  // Get the menu item elements
  const tosMenuItem = document.getElementById('tosMenuItem');
  const privacyMenuItem = document.getElementById('privacyMenuItem');
  
  // Set up modal closing functionality
  closeModalButtons.forEach(button => {
    button.addEventListener('click', function() {
      termsOfServiceModal.style.display = 'none';
      privacyPolicyModal.style.display = 'none';
    });
  });
  
  // Close modals when clicking outside
  [termsOfServiceModal, privacyPolicyModal].forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  });
  
  // Side menu Terms of Service link
  if (tosMenuItem) {
    tosMenuItem.addEventListener('click', function() {
      termsOfServiceModal.style.display = 'flex';
      
      // Close the side menu
      const sideMenu = document.getElementById("sideMenu");
      const menuOverlay = document.getElementById("menuOverlay");
      
      if (sideMenu) sideMenu.classList.remove("open");
      if (menuOverlay) menuOverlay.classList.remove("show");
    });
  }
  
  // Side menu Privacy Policy link
  if (privacyMenuItem) {
    privacyMenuItem.addEventListener('click', function() {
      privacyPolicyModal.style.display = 'flex';
      
      // Close the side menu
      const sideMenu = document.getElementById("sideMenu");
      const menuOverlay = document.getElementById("menuOverlay");
      
      if (sideMenu) sideMenu.classList.remove("open");
      if (menuOverlay) menuOverlay.classList.remove("show");
    });
  }
});

