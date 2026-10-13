import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EditProfileModal from '../EditProfileModal';

describe('EditProfileModal Component', () => {
  const defaultProps = {
    setShowEditProfileModal: vi.fn(),
    handleEditProfileSubmit: vi.fn((e) => e.preventDefault()),
    editBio: 'Initial bio',
    setEditBio: vi.fn(),
    imageSrc: null,
    setImageSrc: vi.fn(),
    crop: { x: 0, y: 0 },
    setCrop: vi.fn(),
    zoom: 1,
    setZoom: vi.fn(),
    onCropComplete: vi.fn(),
    onFileChange: vi.fn(),
    removePhoto: false,
    setRemovePhoto: vi.fn()
  };

  it('renders bio input and action buttons', () => {
    render(<EditProfileModal {...defaultProps} />);

    expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tell us about yourself...')).toHaveValue('Initial bio');
    expect(screen.getByText('Choose an image')).toBeInTheDocument();
    expect(screen.getByText('Remove current photo')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save Changes')).toBeInTheDocument();
  });

  it('triggers setEditBio on text change', () => {
    render(<EditProfileModal {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Tell us about yourself...');
    fireEvent.change(textarea, { target: { value: 'New bio content' } });
    expect(defaultProps.setEditBio).toHaveBeenCalledWith('New bio content');
  });

  it('triggers setRemovePhoto when clicking remove photo button', () => {
    render(<EditProfileModal {...defaultProps} />);
    const removeBtn = screen.getByText('Remove current photo');
    fireEvent.click(removeBtn);
    expect(defaultProps.setRemovePhoto).toHaveBeenCalledWith(true);
  });

  it('triggers handleEditProfileSubmit on form submission', () => {
    render(<EditProfileModal {...defaultProps} />);
    const saveBtn = screen.getByText('Save Changes');
    fireEvent.click(saveBtn);
    expect(defaultProps.handleEditProfileSubmit).toHaveBeenCalled();
  });

  it('triggers cancel and closes modal', () => {
    render(<EditProfileModal {...defaultProps} />);
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    expect(defaultProps.setShowEditProfileModal).toHaveBeenCalledWith(false);
  });
});
