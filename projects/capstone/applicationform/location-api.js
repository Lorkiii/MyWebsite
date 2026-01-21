/**
 * Philippine Location API Helper using PSGC (Philippine Standard Geographic Code)
 * API Base: https://psgc.gitlab.io/api/
 * 
 * This module provides functions to fetch and cache Philippine location data:
 * - Provinces
 * - Cities/Municipalities (by province)
 * - Barangays (by city/municipality)
 */

const PSGC_API_BASE = 'https://psgc.gitlab.io/api';

// In-memory cache to avoid redundant API calls
const locationCache = {
  provinces: null,
  cities: {},      // key: provinceCode
  barangays: {}    // key: cityCode
};

/**
 * Fetch all provinces in the Philippines
 * @returns {Promise<Array>} Array of province objects with { code, name, regionCode }
 */
export async function fetchProvinces() {
  if (locationCache.provinces) {
    return locationCache.provinces;
  }

  try {
    const response = await fetch(`${PSGC_API_BASE}/provinces/`);
    if (!response.ok) throw new Error(`Failed to fetch provinces: ${response.status}`);
    
    const data = await response.json();
    locationCache.provinces = data.sort((a, b) => a.name.localeCompare(b.name));
    return locationCache.provinces;
  } catch (error) {
    console.error('Error fetching provinces:', error);
    throw error;
  }
}

/**
 * Fetch all cities/municipalities for a specific province
 * @param {string} provinceCode - PSGC code of the province
 * @returns {Promise<Array>} Array of city/municipality objects
 */
export async function fetchCitiesByProvince(provinceCode) {
  if (!provinceCode) return [];
  
  if (locationCache.cities[provinceCode]) {
    return locationCache.cities[provinceCode];
  }

  try {
    const response = await fetch(`${PSGC_API_BASE}/provinces/${provinceCode}/cities-municipalities/`);
    if (!response.ok) throw new Error(`Failed to fetch cities: ${response.status}`);
    
    const data = await response.json();
    locationCache.cities[provinceCode] = data.sort((a, b) => a.name.localeCompare(b.name));
    return locationCache.cities[provinceCode];
  } catch (error) {
    console.error('Error fetching cities:', error);
    throw error;
  }
}

/**
 * Fetch all barangays for a specific city/municipality
 * @param {string} cityCode - PSGC code of the city/municipality
 * @returns {Promise<Array>} Array of barangay objects
 */
export async function fetchBarangaysByCity(cityCode) {
  if (!cityCode) return [];
  
  if (locationCache.barangays[cityCode]) {
    return locationCache.barangays[cityCode];
  }

  try {
    const response = await fetch(`${PSGC_API_BASE}/cities-municipalities/${cityCode}/barangays/`);
    if (!response.ok) throw new Error(`Failed to fetch barangays: ${response.status}`);
    
    const data = await response.json();
    locationCache.barangays[cityCode] = data.sort((a, b) => a.name.localeCompare(b.name));
    return locationCache.barangays[cityCode];
  } catch (error) {
    console.error('Error fetching barangays:', error);
    throw error;
  }
}

/**
 * Populate a select element with options
 * @param {HTMLSelectElement} selectElement - The select dropdown element
 * @param {Array} items - Array of items with { code, name }
 * @param {string} placeholder - Placeholder text for the first option
 */
export function populateSelect(selectElement, items, placeholder = 'Select...') {
  if (!selectElement) return;
  
  // Clear existing options except the first (placeholder)
  selectElement.innerHTML = `<option value="">${placeholder}</option>`;
  
  // Add new options
  items.forEach(item => {
    const option = document.createElement('option');
    option.value = item.code;
    option.textContent = item.name;
    option.dataset.name = item.name; // Store name for easy retrieval
    selectElement.appendChild(option);
  });
}

/**
 * Get the selected text (name) from a select element
 * @param {HTMLSelectElement} selectElement 
 * @returns {string} Selected option text or empty string
 */
export function getSelectedText(selectElement) {
  if (!selectElement || !selectElement.value) return '';
  const selectedOption = selectElement.options[selectElement.selectedIndex];
  return selectedOption ? selectedOption.textContent : '';
}

/**
 * Setup cascading dropdowns for Philippine locations
 * @param {Object} config - Configuration object
 * @param {string} config.provinceId - ID of province select element
 * @param {string} config.cityId - ID of city select element
 * @param {string} config.barangayId - ID of barangay select element
 * @param {Function} config.onProvinceChange - Optional callback when province changes
 * @param {Function} config.onCityChange - Optional callback when city changes
 * @param {Function} config.onBarangayChange - Optional callback when barangay changes
 */
export async function setupLocationDropdowns(config) {
  const {
    provinceId,
    cityId,
    barangayId,
    onProvinceChange,
    onCityChange,
    onBarangayChange
  } = config;

  const provinceSelect = document.getElementById(provinceId);
  const citySelect = document.getElementById(cityId);
  const barangaySelect = document.getElementById(barangayId);

  if (!provinceSelect || !citySelect || !barangaySelect) {
    console.error('Location dropdowns not found:', { provinceId, cityId, barangayId });
    return;
  }

  // Load provinces on init
  try {
    const provinces = await fetchProvinces();
    populateSelect(provinceSelect, provinces, 'Select Province');
  } catch (error) {
    console.error('Failed to load provinces:', error);
    provinceSelect.innerHTML = '<option value="">Failed to load provinces</option>';
  }

  // Province change handler
  provinceSelect.addEventListener('change', async function() {
    const provinceCode = this.value;
    
    // Reset dependent dropdowns
    citySelect.innerHTML = '<option value="">Select City/Municipality</option>';
    barangaySelect.innerHTML = '<option value="">Select Barangay</option>';
    citySelect.disabled = !provinceCode;
    barangaySelect.disabled = true;

    if (provinceCode) {
      citySelect.disabled = true;
      citySelect.innerHTML = '<option value="">Loading cities...</option>';
      
      try {
        const cities = await fetchCitiesByProvince(provinceCode);
        populateSelect(citySelect, cities, 'Select City/Municipality');
        citySelect.disabled = false;
      } catch (error) {
        console.error('Failed to load cities:', error);
        citySelect.innerHTML = '<option value="">Failed to load cities</option>';
        citySelect.disabled = false;
      }
    }

    if (onProvinceChange) onProvinceChange(provinceCode);
  });

  // City change handler
  citySelect.addEventListener('change', async function() {
    const cityCode = this.value;
    
    // Reset barangay dropdown
    barangaySelect.innerHTML = '<option value="">Select Barangay</option>';
    barangaySelect.disabled = !cityCode;

    if (cityCode) {
      barangaySelect.disabled = true;
      barangaySelect.innerHTML = '<option value="">Loading barangays...</option>';
      
      try {
        const barangays = await fetchBarangaysByCity(cityCode);
        populateSelect(barangaySelect, barangays, 'Select Barangay');
        barangaySelect.disabled = false;
      } catch (error) {
        console.error('Failed to load barangays:', error);
        barangaySelect.innerHTML = '<option value="">Failed to load barangays</option>';
        barangaySelect.disabled = false;
      }
    }

    if (onCityChange) onCityChange(cityCode);
  });

  // Barangay change handler
  if (onBarangayChange) {
    barangaySelect.addEventListener('change', function() {
      onBarangayChange(this.value);
    });
  }

  // Initially disable city and barangay
  citySelect.disabled = true;
  barangaySelect.disabled = true;
}

/**
 * Clear location cache (useful for testing or forcing refresh)
 */
export function clearCache() {
  locationCache.provinces = null;
  locationCache.cities = {};
  locationCache.barangays = {};
}

